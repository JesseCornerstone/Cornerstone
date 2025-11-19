using System.Data.SqlClient;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

var builder = WebApplication.CreateBuilder(args);

// 1) Get connection string
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is missing.");

// 2) Base URL for the report page (BCC.html with ?key=...)
var reportBaseUrl = builder.Configuration["App:ReportBaseUrl"]
    ?? "https://cornerstoneplus-hqhferewfdhsh4b0.australiaeast-01.azurewebsites.net";

// 3) CORS so Squarespace JS can call /api/create-token and /api/finalise-token
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .AllowAnyOrigin()   // TODO: later restrict to your Squarespace domain
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();


// ==============================
// GLOBAL GATEKEEPER MIDDLEWARE
// ==============================
// This runs for every request and enforces:
// - /api/create-token and /api/finalise-token are always allowed
// - static assets (/js, /css, /images, etc.) are allowed
// - everything else MUST have a valid ?key=... or gets 403
app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    // 1) Always allow Squarespace-to-API calls (no key yet)
    if (path.StartsWithSegments("/api/create-token") ||
        path.StartsWithSegments("/api/finalise-token"))
    {
        await next();
        return;
    }

    // 2) Allow static assets (adjust paths to match your project structure)
    if (path.StartsWithSegments("/js") ||
        path.StartsWithSegments("/css") ||
        path.StartsWithSegments("/images") ||
        path.StartsWithSegments("/lib") ||
        path.StartsWithSegments("/favicon.ico"))
    {
        await next();
        return;
    }

    // 3) Everything else: require a key
    var key = context.Request.Query["key"].ToString();

    if (string.IsNullOrWhiteSpace(key))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsync("Access denied. Valid report link required.");
        return;
    }

    // 4) Check key against database
    var isValid = false;
    await using (var conn = new SqlConnection(connectionString))
    {
        await conn.OpenAsync();

        var sql = @"
            SELECT COUNT(*)
            FROM dbo.ReportAccessTokens
            WHERE Token = @Token
              AND Used = 0
              AND ExpiresAt > SYSUTCDATETIME();
        ";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Token", key);

        var count = (int) (await cmd.ExecuteScalarAsync() ?? 0);
        isValid = count > 0;
    }

    if (!isValid)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsync("This link is invalid, expired, or already used.");
        return;
    }

    // 5) Token is valid → continue pipeline (serve BCC.html, other pages, APIs, etc.)
    await next();
});

// Static files (BCC.html, scripts, etc.)
app.UseDefaultFiles();
app.UseStaticFiles();


// ==========================
// POST /api/create-token
// Called AFTER payment (from Squarespace JS).
// Creates a one-time token and returns the report URL.
// ==========================
app.MapPost("/api/create-token", async (CreateTokenRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.OrderId))
    {
        return Results.BadRequest("Missing email or order id.");
    }

    // Generate a random URL-safe token
    var token = GenerateToken(32);

    // Insert into dbo.ReportAccessTokens
    await using (var conn = new SqlConnection(connectionString))
    {
        await conn.OpenAsync();

        var sql = @"
            INSERT INTO dbo.ReportAccessTokens (Token, UserEmail, PaymentId, ExpiresAt)
            VALUES (@Token, @UserEmail, @PaymentId, DATEADD(HOUR, 24, SYSUTCDATETIME()));
        ";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Token", token);
        cmd.Parameters.AddWithValue("@UserEmail", req.Email);
        cmd.Parameters.AddWithValue("@PaymentId", req.OrderId);

        await cmd.ExecuteNonQueryAsync();
    }

    // Build URL to BCC.html with ?key=...
    var url = $"{reportBaseUrl.TrimEnd('/')}" +
              (reportBaseUrl.Contains("?") ? "&" : "?") +
              $"key={token}";

    return Results.Json(new CreateTokenResponse(url));
});


// ==========================
// POST /api/finalise-token?key=...
// Called from BCC.html AFTER the report is fully exported/printed.
// Marks the token as used. Redirect is handled by the front-end.
// ==========================
app.MapPost("/api/finalise-token", async (HttpContext ctx) =>
{
    var key = ctx.Request.Query["key"].ToString();

    if (string.IsNullOrWhiteSpace(key))
        return Results.BadRequest("Missing key.");

    int rowsAffected;

    await using (var conn = new SqlConnection(connectionString))
    {
        await conn.OpenAsync();

        var sql = @"
            UPDATE dbo.ReportAccessTokens
            SET Used = 1,
                UsedAt = SYSUTCDATETIME()
            WHERE Token = @Token
              AND Used = 0
              AND ExpiresAt > SYSUTCDATETIME();
        ";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Token", key);

        rowsAffected = await cmd.ExecuteNonQueryAsync();
    }

    if (rowsAffected == 0)
    {
        return Results.BadRequest("This report link is invalid, expired, or already used.");
    }

    return Results.Ok();
});

app.Run();


// ==========================
// Helpers & record types
// ==========================

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
