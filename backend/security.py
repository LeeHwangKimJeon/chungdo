from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit


MAX_PAGE_BYTES = 1_500_000
MAX_PAGE_TEXT = 24_000
MAX_REDIRECTS = 4
FETCH_TIMEOUT_SECONDS = 8
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_HIDDEN_TAGS = {"script", "style", "noscript", "svg"}


class PostingFetchError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class PublicTarget:
    url: str
    host: str
    port: int
    address: str
    request_target: str
    host_header: str


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HIDDEN_TAGS:
            self.hidden_depth += 1
        elif not self.hidden_depth and tag in {"br", "p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN_TAGS and self.hidden_depth:
            self.hidden_depth -= 1
        elif not self.hidden_depth and tag in {"p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            text = re.sub(r"\s+", " ", data).strip()
            if text:
                self.parts.append(text)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, target: PublicTarget) -> None:
        super().__init__(
            target.host,
            target.port,
            timeout=FETCH_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        )
        self._resolved_address = target.address

    def connect(self) -> None:
        sock = socket.create_connection(
            (self._resolved_address, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def resolve_public_target(raw_url: str) -> PublicTarget:
    try:
        parsed = urlsplit(raw_url)
        if (
            parsed.scheme.lower() != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
        ):
            raise PostingFetchError(
                "INVALID_URL",
                "HTTPS 기본 포트(443)를 사용하는 공고 URL을 입력해 주세요.",
            )
        if parsed.fragment:
            raw_url = urlunsplit(
                (parsed.scheme, parsed.netloc, parsed.path, parsed.query, "")
            )
            parsed = urlsplit(raw_url)

        host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
        if not host or "%" in host:
            raise PostingFetchError("INVALID_URL", "공고 URL의 호스트가 올바르지 않습니다.")

        try:
            literal = ipaddress.ip_address(host)
            addresses = [str(literal)]
        except ValueError:
            try:
                records = socket.getaddrinfo(
                    host, 443, type=socket.SOCK_STREAM
                )
            except socket.gaierror as exc:
                raise PostingFetchError(
                    "FETCH_FAILED", "공고 주소를 확인할 수 없습니다.", True
                ) from exc
            addresses = list(dict.fromkeys(record[4][0] for record in records))

        if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
            raise PostingFetchError(
                "URL_NOT_ALLOWED",
                "공개 인터넷에서 접근할 수 있는 HTTPS 공고 주소만 허용됩니다.",
            )

        address = addresses[0]
        path = parsed.path or "/"
        request_target = path + (f"?{parsed.query}" if parsed.query else "")
        host_header = f"[{host}]" if ":" in host else host
        return PublicTarget(
            url=raw_url,
            host=host,
            port=443,
            address=address,
            request_target=request_target,
            host_header=host_header,
        )
    except PostingFetchError:
        raise
    except (UnicodeError, ValueError) as exc:
        raise PostingFetchError("INVALID_URL", "공고 URL 형식이 올바르지 않습니다.") from exc


def _read_html(target: PublicTarget) -> tuple[int, str | None, str, bytes]:
    connection = _PinnedHTTPSConnection(target)
    try:
        connection.request(
            "GET",
            target.request_target,
            headers={
                "Host": target.host_header,
                "User-Agent": "ChungdoJobBoard/1.0",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Encoding": "identity",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        content_type = response.getheader("Content-Type", "")
        location = response.getheader("Location")

        if response.status in _REDIRECT_STATUSES:
            return response.status, location, content_type, b""
        if response.status < 200 or response.status >= 300:
            raise PostingFetchError(
                "UNSUPPORTED_PAGE",
                "공고 페이지에 접근할 수 없습니다. 로그인이나 접근 권한이 필요한지 확인해 주세요.",
            )
        if "text/html" not in content_type.lower() and "application/xhtml+xml" not in content_type.lower():
            raise PostingFetchError(
                "UNSUPPORTED_PAGE", "HTML 형식의 공개 공고 페이지가 아닙니다."
            )
        body = response.read(MAX_PAGE_BYTES + 1)
        if len(body) > MAX_PAGE_BYTES:
            raise PostingFetchError(
                "PAGE_TOO_LARGE", "공고 페이지가 허용된 크기를 초과했습니다."
            )
        return response.status, location, content_type, body
    except (socket.timeout, TimeoutError) as exc:
        raise PostingFetchError(
            "FETCH_TIMEOUT", "공고 페이지 응답 시간이 초과되었습니다.", True
        ) from exc
    except PostingFetchError:
        raise
    except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
        raise PostingFetchError(
            "FETCH_FAILED", "공고 페이지에 연결하지 못했습니다.", True
        ) from exc
    finally:
        connection.close()


def fetch_posting_text(raw_url: str) -> tuple[str, str]:
    current_url = raw_url
    for redirect_count in range(MAX_REDIRECTS + 1):
        target = resolve_public_target(current_url)
        status, location, _content_type, body = _read_html(target)
        if status in _REDIRECT_STATUSES:
            if not location:
                raise PostingFetchError(
                    "FETCH_FAILED", "공고 페이지가 잘못된 리디렉션을 반환했습니다."
                )
            if redirect_count == MAX_REDIRECTS:
                raise PostingFetchError(
                    "REDIRECT_NOT_ALLOWED", "공고 페이지의 리디렉션 횟수가 너무 많습니다."
                )
            current_url = urljoin(target.url, location)
            continue

        parser = _TextExtractor()
        parser.feed(body.decode("utf-8", errors="replace"))
        parser.close()
        text = re.sub(r"[ \t]+\n", "\n", " ".join(parser.parts))
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if not text:
            raise PostingFetchError(
                "UNSUPPORTED_PAGE",
                "공고 본문을 찾을 수 없습니다. 직접 정보를 입력해 주세요.",
            )
        return text[:MAX_PAGE_TEXT], current_url

    raise PostingFetchError("REDIRECT_NOT_ALLOWED", "공고 페이지의 리디렉션이 허용되지 않습니다.")
