using System.Data.SqlClient;
using System.Security.Cryptography;

var builder = WebApplication.CreateBuilder(args);

// Put your Azure SQL connection string in appsettings.json under "ConnectionStrings:DefaultConnection"
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

var app = builder.Build();

app.MapPost("/api/create-token", async (CreateTokenRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.OrderId))
    {
        return Results.BadRequest("Missing email or order id.");
    }

    // 1) Generate a random URL-safe token
    var token = GenerateToken(32);

    // 2) Insert into SQL
    await using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    var sql = @"
        INSERT INTO dbo.ReportAccessTokens (Token, UserEmail, PaymentId, ExpiresAt)
        VALUES (@Token, @UserEmail, @PaymentId, DATEADD(HOUR, 24, SYSUTCDATETIME()));
    ";

    await using (var cmd = new SqlCommand(sql, conn))
    {
        cmd.Parameters.AddWithValue("@Token", token);
        cmd.Parameters.AddWithValue("@UserEmail", req.Email);
        cmd.Parameters.AddWithValue("@PaymentId", req.OrderId);

        await cmd.ExecuteNonQueryAsync();
    }

    // 3) Build report URL
    var reportUrl =
        $"https://cornerstoneplus-hqhferewfdhsh4b0.australiaeast-01.azurewebsites.net/report?key={token}";

    return Results.Json(new CreateTokenResponse(reportUrl));
});

app.Run();

static string GenerateToken(int byteLength)
{
    var bytes = new byte[byteLength];
    RandomNumberGenerator.Fill(bytes);

    // URL-safe base64-ish string
    return Convert.ToBase64String(bytes)
        .Replace("+", "-")
        .Replace("/", "_")
        .TrimEnd('=');
}

public record CreateTokenRequest(string Email, string OrderId);
public record CreateTokenResponse(string ReportUrl);
