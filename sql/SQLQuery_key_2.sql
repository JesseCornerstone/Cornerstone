------------------------------------------------------------
-- 1) Drop any old version of the table (only needed once)
------------------------------------------------------------
IF OBJECT_ID('dbo.ReportAccessTokens', 'U') IS NOT NULL
    DROP TABLE dbo.ReportAccessTokens;
GO

------------------------------------------------------------
-- 2) Create the new token table
--    This is completely independent of your old Users table.
------------------------------------------------------------
CREATE TABLE dbo.ReportAccessTokens (
    TokenId     INT IDENTITY(1,1) PRIMARY KEY,          -- internal numeric id
    Token       NVARCHAR(128) NOT NULL UNIQUE,          -- one-time key in URL
    UserEmail   NVARCHAR(320) NULL,                     -- optional
    PaymentId   NVARCHAR(100) NULL,                     -- optional
    ExpiresAt   DATETIME2(0) NOT NULL,                  -- when link expires
    Used        BIT NOT NULL 
                    CONSTRAINT DF_ReportAccessTokens_Used DEFAULT (0),
    UsedAt      DATETIME2(0) NULL,                      -- when link was used
    CreatedAt   DATETIME2(0) NOT NULL 
                    CONSTRAINT DF_ReportAccessTokens_CreatedAt 
                        DEFAULT SYSUTCDATETIME()
);
GO

------------------------------------------------------------
-- 3) Optional: index to quickly search by email
------------------------------------------------------------
CREATE INDEX IX_ReportAccessTokens_UserEmail 
    ON dbo.ReportAccessTokens(UserEmail);
GO

------------------------------------------------------------
-- 4) Quick test - should return 0 rows, but NO errors
------------------------------------------------------------
SELECT TOP (10) *
FROM dbo.ReportAccessTokens;
GO
