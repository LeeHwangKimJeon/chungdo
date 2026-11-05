namespace JobBoard.Api.Services;

public sealed class PostingFetchException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
