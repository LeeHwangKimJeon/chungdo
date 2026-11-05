using Aspire.Hosting.Azure;
using Azure.Provisioning.KeyVault;

var builder = DistributedApplication.CreateBuilder(args);
var web = builder.AddProject<Projects.JobBoard_Api>("web")
    .WithExternalHttpEndpoints();

if (builder.ExecutionContext.IsPublishMode)
{
    var copilotToken = builder.AddParameter("copilot-github-token-value", secret: true);
    var keyVault = builder.AddAzureKeyVault("keyvault");
    keyVault.AddSecret("copilot-github-token", copilotToken);

    builder.AddAzureAppServiceEnvironment("appservice")
        .WithAzureApplicationInsights();

    web.WithEnvironment("COPILOT_GITHUB_TOKEN", keyVault.GetSecret("copilot-github-token"))
        .WithRoleAssignments(keyVault, KeyVaultBuiltInRole.KeyVaultSecretsUser);
}
else if (Environment.GetEnvironmentVariable("COPILOT_GITHUB_TOKEN") is { Length: > 0 } localToken)
{
    web.WithEnvironment("COPILOT_GITHUB_TOKEN", localToken);
}

builder.Build().Run();
