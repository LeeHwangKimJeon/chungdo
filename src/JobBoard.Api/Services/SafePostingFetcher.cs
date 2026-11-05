using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using JobBoard.Api.Models;

namespace JobBoard.Api.Services;

public sealed class SafePostingFetcher
{
    private const int MaxResponseBytes = 1_000_000;
    private const int MaxTextCharacters = 30_000;
    private const int MaxRedirects = 5;

    private static readonly TimeSpan RegexTimeout = TimeSpan.FromSeconds(1);
    private static readonly IPNetwork[] BlockedIpv4Networks =
    [
        IPNetwork.Parse("0.0.0.0/8"),
        IPNetwork.Parse("10.0.0.0/8"),
        IPNetwork.Parse("100.64.0.0/10"),
        IPNetwork.Parse("127.0.0.0/8"),
        IPNetwork.Parse("169.254.0.0/16"),
        IPNetwork.Parse("172.16.0.0/12"),
        IPNetwork.Parse("192.0.0.0/24"),
        IPNetwork.Parse("192.0.2.0/24"),
        IPNetwork.Parse("192.88.99.0/24"),
        IPNetwork.Parse("192.168.0.0/16"),
        IPNetwork.Parse("198.18.0.0/15"),
        IPNetwork.Parse("198.51.100.0/24"),
        IPNetwork.Parse("203.0.113.0/24"),
        IPNetwork.Parse("224.0.0.0/4"),
        IPNetwork.Parse("240.0.0.0/4")
    ];

    private static readonly IPNetwork[] BlockedIpv6Networks =
    [
        IPNetwork.Parse("::/128"),
        IPNetwork.Parse("::1/128"),
        IPNetwork.Parse("64:ff9b::/96"),
        IPNetwork.Parse("100::/64"),
        IPNetwork.Parse("2001:db8::/32"),
        IPNetwork.Parse("2001:10::/28"),
        IPNetwork.Parse("2002::/16"),
        IPNetwork.Parse("fc00::/7"),
        IPNetwork.Parse("fe80::/10"),
        IPNetwork.Parse("ff00::/8")
    ];

    public async Task<PostingPage> FetchAsync(string rawUrl, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));

        var uri = ParsePublicHttpsUrl(rawUrl);
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var redirects = 0; ; redirects++)
        {
            uri = ParsePublicHttpsUrl(uri.AbsoluteUri);
            if (!visited.Add(uri.AbsoluteUri))
            {
                throw new PostingFetchException("redirect_loop", "The page redirected repeatedly.");
            }

            _ = await ResolvePublicAddressesAsync(uri.Host, timeout.Token);
            using var handler = CreateHandler(uri.Host);
            using var client = new HttpClient(handler, disposeHandler: false)
            {
                Timeout = Timeout.InfiniteTimeSpan
            };
            using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
            requestTimeout.CancelAfter(TimeSpan.FromSeconds(10));
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, requestTimeout.Token);

            if ((int)response.StatusCode is >= 300 and < 400)
            {
                if (redirects >= MaxRedirects || response.Headers.Location is null)
                {
                    throw new PostingFetchException("redirect_limit", "The page redirected too many times or provided an invalid redirect.");
                }

                uri = response.Headers.Location.IsAbsoluteUri
                    ? response.Headers.Location
                    : new Uri(uri, response.Headers.Location);
                continue;
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new PostingFetchException("http_error", $"The page returned HTTP {(int)response.StatusCode}.");
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(mediaType, "text/html", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(mediaType, "application/xhtml+xml", StringComparison.OrdinalIgnoreCase))
            {
                throw new PostingFetchException("unsupported_content", "The page did not return HTML content.");
            }

            if (response.Content.Headers.ContentLength > MaxResponseBytes)
            {
                throw new PostingFetchException("response_too_large", "The page is larger than the allowed size.");
            }

            var bytes = await ReadLimitedAsync(response.Content, requestTimeout.Token);
            var html = Encoding.UTF8.GetString(bytes);
            var title = ExtractTitle(html);
            var text = HtmlToText(html);
            if (text.Length > MaxTextCharacters)
            {
                text = text[..MaxTextCharacters];
            }

            if (string.IsNullOrWhiteSpace(text))
            {
                throw new PostingFetchException("empty_page", "The page did not contain readable text.");
            }

            return new PostingPage(uri.AbsoluteUri, title, text);
        }
    }

    public static Uri ParsePublicHttpsUrl(string rawUrl)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(uri.Host) ||
            uri.UserInfo.Length > 0 ||
            uri.Port != 443)
        {
            throw new PostingFetchException("invalid_url", "Enter a public HTTPS URL using the standard secure port.");
        }

        return uri;
    }

    private static SocketsHttpHandler CreateHandler(string expectedHost) => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
        ConnectTimeout = TimeSpan.FromSeconds(8),
        PooledConnectionLifetime = TimeSpan.Zero,
        ConnectCallback = async (context, cancellationToken) =>
        {
            if (!string.Equals(context.DnsEndPoint.Host, expectedHost, StringComparison.OrdinalIgnoreCase))
            {
                throw new PostingFetchException("redirect_host", "The connection host did not match the validated page.");
            }

            var addresses = await ResolvePublicAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
            foreach (var address in addresses)
            {
                var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                try
                {
                    await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch (Exception exception) when (exception is SocketException or OperationCanceledException)
                {
                    socket.Dispose();
                    if (exception is OperationCanceledException)
                    {
                        throw;
                    }
                }
            }

            throw new PostingFetchException("connect_failed", "The public page could not be reached.");
        }
    };

    private static async Task<IPAddress[]> ResolvePublicAddressesAsync(string host, CancellationToken cancellationToken)
    {
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : await Dns.GetHostAddressesAsync(host, cancellationToken);
        }
        catch (SocketException)
        {
            throw new PostingFetchException("dns_failed", "The page host could not be resolved.");
        }

        if (addresses.Length == 0 || addresses.Any(address => !IsPublicAddress(address)))
        {
            throw new PostingFetchException("private_address", "The URL resolves to a private, local, or reserved network address.");
        }

        return addresses;
    }

    private static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return !BlockedIpv4Networks.Any(network => network.Contains(address));
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6 ||
            !IPNetwork.Parse("2000::/3").Contains(address))
        {
            return false;
        }

        return !BlockedIpv6Networks.Any(network => network.Contains(address));
    }

    private static async Task<byte[]> ReadLimitedAsync(HttpContent content, CancellationToken cancellationToken)
    {
        await using var source = await content.ReadAsStreamAsync(cancellationToken);
        using var destination = new MemoryStream();
        var buffer = new byte[16 * 1024];

        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                return destination.ToArray();
            }

            if (destination.Length + read > MaxResponseBytes)
            {
                throw new PostingFetchException("response_too_large", "The page is larger than the allowed size.");
            }

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
    }

    private static string? ExtractTitle(string html)
    {
        var match = Regex.Match(html, @"<title\b[^>]*>(.*?)</title\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline, RegexTimeout);
        return match.Success ? NormalizeText(match.Groups[1].Value) : null;
    }

    private static string HtmlToText(string html)
    {
        var withoutHiddenContent = Regex.Replace(
            html,
            @"<(script|style|noscript)\b[^>]*>.*?</\1\s*>",
            " ",
            RegexOptions.IgnoreCase | RegexOptions.Singleline,
            RegexTimeout);
        return NormalizeText(Regex.Replace(withoutHiddenContent, "<[^>]+>", " ", RegexOptions.Singleline, RegexTimeout));
    }

    private static string NormalizeText(string value) =>
        Regex.Replace(WebUtility.HtmlDecode(value), @"\s+", " ", RegexOptions.None, RegexTimeout).Trim();
}
