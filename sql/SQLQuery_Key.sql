-- Optional: drop an old token table if you were experimenting before
IF OBJECT_ID('dbo.ReportAccessTokens', 'U') IS NOT NULL
    DROP TABLE dbo.ReportAccessTokens;
GO

CREATE TABLE dbo.ReportAccessTokens (
    TokenId     INT IDENTITY(1,1) PRIMARY KEY,      -- internal id
    Token       NVARCHAR(128) NOT NULL UNIQUE,      -- one-time key in the URL
    UserEmail   NVARCHAR(320) NULL,                 -- optional: who it was for
    PaymentId   NVARCHAR(100) NULL,                 -- optional: link to payment
    ExpiresAt   DATETIME2(0) NOT NULL,              -- when link stops working
    Used        BIT NOT NULL 
                    CONSTRAINT DF_ReportAccessTokens_Used DEFAULT (0),
    UsedAt      DATETIME2(0) NULL,                  -- when it was actually used
    CreatedAt   DATETIME2(0) NOT NULL 
                    CONSTRAINT DF_ReportAccessTokens_CreatedAt 
                        DEFAULT SYSUTCDATETIME()
);
GO

-- Optional helpful index if you’ll often look up by email
CREATE INDEX IX_ReportAccessTokens_UserEmail 
    ON dbo.ReportAccessTokens(UserEmail);
GO
