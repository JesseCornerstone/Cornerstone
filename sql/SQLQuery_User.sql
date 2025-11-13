CREATE TABLE dbo.Users (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  FirstName     NVARCHAR(100) NOT NULL,
  LastName      NVARCHAR(100) NOT NULL,
  Email         NVARCHAR(320) NOT NULL UNIQUE,
  Company       NVARCHAR(200) NULL,
  Role          NVARCHAR(100) NULL,
  PasswordHash  NVARCHAR(200) NOT NULL,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email);
