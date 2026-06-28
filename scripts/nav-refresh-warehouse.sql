-- ============================================================================
-- usp_RefreshWarehouse  —  keeps the Warehousing module's two replica tables
-- (ReplitReports.dbo.InventoryOnHand + dbo.TransferLines) in sync with the live
-- NAV company DB (Samsonite). Bolt this onto the existing 15-min ReplitReports
-- job as one extra step:  EXEC dbo.usp_RefreshWarehouse;
--
-- Each table is rebuilt inside its own transaction (TRUNCATE + INSERT) so the
-- dashboard never catches a table half-empty, and a failure in one doesn't leave
-- the other partially written. Body is the EXACT populate SQL that was run by hand
-- to first create the tables.
-- ============================================================================
USE ReplitReports;
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
  --    live picture of "still open" transfers; QtyShipped/QtyReceived = posted qty.
  BEGIN TRY
    BEGIN TRAN;
      TRUNCATE TABLE dbo.TransferLines;
      INSERT INTO dbo.TransferLines (DocumentNo, Status, TransferFrom, TransferTo, ItemNo, Quantity, QtyShipped, QtyReceived, ShipmentDate, ReceiptDate)
      SELECT l.[Document No_], CAST(h.[Status] AS nvarchar(50)), h.[Transfer-from Code], h.[Transfer-to Code],
             l.[Item No_], l.[Quantity], l.[Quantity Shipped], l.[Quantity Received], h.[Shipment Date], h.[Receipt Date]
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
