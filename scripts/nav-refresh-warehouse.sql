-- ============================================================================
-- usp_RefreshWarehouse  —  keeps the Warehousing module's two replica tables
-- (ReplitReports.dbo.InventoryOnHand + dbo.TransferLines) in sync with the live
-- NAV company DB (Samsonite). Bolt this onto the existing 15-min ReplitReports
-- job (it's appended to the end of step 3, Refresh_SalesCrMemoLine):
--     EXEC dbo.usp_RefreshWarehouse;
--
-- Each table is rebuilt inside its own transaction (TRUNCATE + INSERT) so the
-- dashboard never catches a table half-empty, and a failure in one doesn't leave
-- the other partially written. RetailStatus is the custom NAV "Retail Status"
-- option field (int: 0=New, 1=Sent, 2=Part. receipt, 3=Closed-ok,
-- 4=Closed-difference, 5=To receive, 6=Planned receive) — shown for visibility.
-- ============================================================================
USE ReplitReports;
GO

-- One-time: add the RetailStatus column if it isn't there yet.
IF COL_LENGTH('dbo.TransferLines', 'RetailStatus') IS NULL
  ALTER TABLE dbo.TransferLines ADD RetailStatus int NULL;
GO

CREATE OR ALTER PROCEDURE dbo.usp_RefreshWarehouse
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  -- 1) Inventory on-hand: summed item-ledger qty per item × location (incl. HO).
  BEGIN TRY
    BEGIN TRAN;
      TRUNCATE TABLE dbo.InventoryOnHand;
      INSERT INTO dbo.InventoryOnHand (ItemNo, LocationCode, Qty)
      SELECT [Item No_], [Location Code], SUM([Quantity])
      FROM [Samsonite].[dbo].[Le Souverain$Item Ledger Entry]
      GROUP BY [Item No_], [Location Code];
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;

  -- 2) Open transfer-order lines. NAV DELETES fully-received orders, so this is a
  --    live picture of "still open" transfers; QtyShipped/QtyReceived = posted qty,
  --    RetailStatus = the custom workflow status (New / Sent / ...).
  BEGIN TRY
    BEGIN TRAN;
      TRUNCATE TABLE dbo.TransferLines;
      INSERT INTO dbo.TransferLines (DocumentNo, Status, TransferFrom, TransferTo, ItemNo, Quantity, QtyShipped, QtyReceived, ShipmentDate, ReceiptDate, RetailStatus)
      SELECT l.[Document No_], CAST(h.[Status] AS nvarchar(50)), h.[Transfer-from Code], h.[Transfer-to Code],
             l.[Item No_], l.[Quantity], l.[Quantity Shipped], l.[Quantity Received], h.[Shipment Date], h.[Receipt Date], h.[Retail Status]
      FROM [Samsonite].[dbo].[Le Souverain$Transfer Line] l
      JOIN [Samsonite].[dbo].[Le Souverain$Transfer Header] h ON h.[No_] = l.[Document No_]
      WHERE l.[Item No_] <> '';
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH;
END
GO

-- Repopulate now so RetailStatus fills in immediately (the job will keep it fresh).
EXEC dbo.usp_RefreshWarehouse;
SELECT RetailStatus, COUNT(*) AS lines FROM dbo.TransferLines GROUP BY RetailStatus ORDER BY RetailStatus;
GO
