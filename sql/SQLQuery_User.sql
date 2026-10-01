CREATE TABLE dbo.ReportAccessKeys (
    KeyId        INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT NOT NULL,
    Token        NVARCHAR(128) NOT NULL,   -- the one-time key in the URL
    PaymentId    NVARCHAR(100) NULL,       -- e.g. Stripe/PayPal transaction id
    ExpiresAt    DATETIME2(0) NOT NULL,    -- when the link stops working
    Used         BIT NOT NULL CONSTRAINT DF_ReportAccessKeys_Used DEFAULT (0),
    UsedAt       DATETIME2(0) NULL,        -- when it was actually used
    CreatedAt    DATETIME2(0) NOT NULL
                    CONSTRAINT DF_ReportAccessKeys_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ReportAccessKeys_Users
        FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId)
);
GO

CREATE UNIQUE INDEX UX_ReportAccessKeys_Token ON dbo.ReportAccessKeys(Token);
GO
