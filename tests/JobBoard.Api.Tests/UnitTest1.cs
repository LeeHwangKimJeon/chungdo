using JobBoard.Api.Services;

namespace JobBoard.Api.Tests;

public sealed class SafePostingFetcherTests
{
    private readonly SafePostingFetcher _fetcher = new();

    [Theory]
    [InlineData("http://example.com/jobs/1")]
    [InlineData("https://example.com:8443/jobs/1")]
    [InlineData("https://user:password@example.com/jobs/1")]
    [InlineData("file:///etc/passwd")]
    public async Task FetchAsyncRejectsNonStandardHttpsUrls(string url)
    {
        var exception = await Assert.ThrowsAsync<PostingFetchException>(
            () => _fetcher.FetchAsync(url, CancellationToken.None));

        Assert.Equal("invalid_url", exception.Code);
    }

    [Theory]
    [InlineData("https://127.0.0.1/")]
    [InlineData("https://10.2.3.4/")]
    [InlineData("https://169.254.169.254/latest/meta-data/")]
    [InlineData("https://[::1]/")]
    [InlineData("https://localhost/")]
    public async Task FetchAsyncRejectsLocalAndPrivateDestinations(string url)
    {
        var exception = await Assert.ThrowsAsync<PostingFetchException>(
            () => _fetcher.FetchAsync(url, CancellationToken.None));

        Assert.Equal("private_address", exception.Code);
    }

    [Fact]
    public void ParsePublicHttpsUrlAcceptsStandardHttpsAddress()
    {
        var result = SafePostingFetcher.ParsePublicHttpsUrl("https://jobs.example.org/opening?id=4");

        Assert.Equal("jobs.example.org", result.Host);
        Assert.Equal(443, result.Port);
    }
}
