/* ========= One-time install: a flexible login verifier for SQL Server ========= */
CREATE OR ALTER PROCEDURE dbo.usp_LoginVerify
  @Schema         SYSNAME,                -- e.g. 'dbo'
  @Table          SYSNAME,                -- e.g. 'Users' or 'AspNetUsers'
  @IdentifierCol  SYSNAME,                -- e.g. 'Email' or 'UserName' or 'NormalizedEmail'
  @PasswordCol    SYSNAME = NULL,         -- e.g. 'PasswordHash' (NULL for SSO-only/profile lookup)
  @SaltCol        SYSNAME = NULL,         -- e.g. 'Salt' (NULL if not used)
  @Identifier     NVARCHAR(320),          -- value supplied by the login form (email/username)
  @Password       NVARCHAR(4000) = NULL,  -- plaintext password from the form (if you store passwords)
  @HashMode       VARCHAR(20) = 'NONE'    -- ONE OF: 'NONE' | 'PLAINTEXT' | 'SHA512' | 'SALTED_SHA512' | 'ASP_IDENTITY'
AS
BEGIN
  SET NOCOUNT ON;

  IF @Schema IS NULL OR @Table IS NULL OR @IdentifierCol IS NULL
  BEGIN
    RAISERROR('Schema, Table, and IdentifierCol are required.', 16, 1);
    RETURN;
  END

  DECLARE @verifyExpr NVARCHAR(MAX) = N'CAST(NULL AS BIT)';
  DECLARE @note       NVARCHAR(200) = N'';

  -- Decide how to verify (or not) based on @HashMode
  IF UPPER(@HashMode) = 'NONE'
  BEGIN
    SET @verifyExpr = N'CAST(NULL AS BIT)';
    SET @note       = N'No password column used; verify in application/SSO.';
  END
  ELSE IF UPPER(@HashMode) = 'ASP_IDENTITY'
  BEGIN
    SET @verifyExpr = N'CAST(NULL AS BIT)';
    SET @note       = N'ASP.NET Identity (PBKDF2) hash; verify password in application code.';
  END
  ELSE
  BEGIN
    IF @PasswordCol IS NULL
    BEGIN
      RAISERROR('PasswordCol is required for hash modes other than NONE/ASP_IDENTITY.', 16, 1);
      RETURN;
    END

    IF UPPER(@HashMode) = 'PLAINTEXT'
    BEGIN
      SET @verifyExpr = N'CASE WHEN I.' + QUOTENAME(@PasswordCol) +
                        N' = @Password THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END';
      SET @note       = N'PLAINTEXT password (NOT SECURE) — consider hashing.';
    END
    ELSE IF UPPER(@HashMode) = 'SHA512'
    BEGIN
      SET @verifyExpr = N'CASE WHEN I.' + QUOTENAME(@PasswordCol) +
                        N' = HASHBYTES(''SHA2_512'', CONVERT(VARBINARY(MAX), @Password)) ' +
                        N'THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END';
      SET @note       = N'Verified via SHA-512 (unsalted VARBINARY).';
    END
    ELSE IF UPPER(@HashMode) = 'SALTED_SHA512'
    BEGIN
      IF @SaltCol IS NULL
      BEGIN
        RAISERROR('SaltCol is required when HashMode = SALTED_SHA512.', 16, 1);
        RETURN;
      END
      SET @verifyExpr = N'CASE WHEN I.' + QUOTENAME(@PasswordCol) +
                        N' = HASHBYTES(''SHA2_512'', CONVERT(VARBINARY(MAX), I.' + QUOTENAME(@SaltCol) + N') + CONVERT(VARBINARY(MAX), @Password)) ' +
                        N'THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END';
      SET @note       = N'Verified via salted SHA-512 (VARBINARY).';
    END
    ELSE
    BEGIN
      RAISERROR('Unsupported HashMode. Use NONE | PLAINTEXT | SHA512 | SALTED_SHA512 | ASP_IDENTITY.', 16, 1);
      RETURN;
    END
  END

  DECLARE @sql NVARCHAR(MAX) =
    N'SELECT TOP (1) I.*, ' + @verifyExpr + N' AS PasswordVerified, ' +
    N'N''' + REPLACE(@note, N'''', N'''''') + N''' AS Note ' + CHAR(10) +
    N'FROM ' + QUOTENAME(@Schema) + N'.' + QUOTENAME(@Table) + N' AS I ' + CHAR(10) +
    N'WHERE I.' + QUOTENAME(@IdentifierCol) + N' = @Identifier;';

  EXEC sp_executesql
       @sql,
       N'@Identifier NVARCHAR(320), @Password NVARCHAR(4000)',
       @Identifier=@Identifier, @Password=@Password;
END
GO
