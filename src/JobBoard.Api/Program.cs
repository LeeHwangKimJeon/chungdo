using System.Text.Json;
using System.Threading.Channels;
using JobBoard.Api.Models;
using JobBoard.Api.Services;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
builder.Services.AddSingleton<SafePostingFetcher>();
builder.Services.AddSingleton<PostingAnalysisOrchestrator>();
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("posting-analysis", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 8,
                QueueLimit = 0,
                Window = TimeSpan.FromMinutes(1)
            }));
});

var app = builder.Build();
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/analyze", async (
    PostingAnalysisRequest request,
    HttpContext context,
    PostingAnalysisOrchestrator orchestrator) =>
{
    if (string.IsNullOrWhiteSpace(request.Url) || request.Url.Length > 2_048)
    {
        return Results.BadRequest(new { error = "Enter a URL shorter than 2,048 characters." });
    }

    try
    {
        _ = SafePostingFetcher.ParsePublicHttpsUrl(request.Url);
    }
    catch (PostingFetchException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-cache, no-transform";
    context.Response.Headers.Connection = "keep-alive";
    context.Response.Headers["X-Accel-Buffering"] = "no";

    var events = Channel.CreateUnbounded<PostingProgressEvent>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });

    events.Writer.TryWrite(new PostingProgressEvent("stage", "api", "공고 분석을 시작합니다."));
    var analysisTask = orchestrator.RunAsync(request.Url, events.Writer, context.RequestAborted);
    await context.Response.StartAsync(context.RequestAborted);

    try
    {
        await foreach (var progress in events.Reader.ReadAllAsync(context.RequestAborted))
        {
            var json = JsonSerializer.Serialize(progress, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await context.Response.WriteAsync($"data: {json}\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
        }

        await analysisTask;
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        try
        {
            await analysisTask;
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
        }
    }
    return Results.Empty;
}).RequireRateLimiting("posting-analysis");

app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;
