namespace JobBoard.Api.Models;

public sealed record PostingAnalysisRequest(string Url);

public sealed record PostingCandidate(string Field, string? Value, string? Evidence, bool Verified, string? Note);

public sealed record PostingAnalysisResult(string Url, string? PageTitle, bool AiGenerated, IReadOnlyList<PostingCandidate> Fields);

public sealed record PostingProgressEvent(string Type, string? Agent = null, string? Text = null, PostingAnalysisResult? Result = null);

public sealed record PostingPage(string Url, string? Title, string Text);

public sealed record ExtractedPosting(IReadOnlyList<ExtractedField> Fields);

public sealed record ExtractedField(string Field, string? Value, string? Evidence);

public sealed record VerifiedPosting(IReadOnlyList<VerifiedField> Fields);

public sealed record VerifiedField(string Field, bool Verified, string? Note);
