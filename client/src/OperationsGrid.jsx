import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  CsvExportModule,
  DateFilterModule,
  ModuleRegistry,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
  themeQuartz,
} from "ag-grid-community";
import "./OperationsGrid.css";

ModuleRegistry.registerModules([
  CellStyleModule,
  ClientSideRowModelModule,
  CsvExportModule,
  DateFilterModule,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
]);

const operationsTheme = themeQuartz.withParams({
  accentColor: "#2563eb",
  backgroundColor: "#ffffff",
  foregroundColor: "#172033",
  borderColor: "#e5eaf1",
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#64748b",
  oddRowBackgroundColor: "#fbfcfe",
  rowHoverColor: "#f1f5fb",
  selectedRowBackgroundColor: "#eff6ff",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: "13px",
  headerFontSize: "11px",
  headerFontWeight: 700,
  cellHorizontalPadding: 14,
  spacing: 6,
});

function createHeaderName(field) {
  return String(field)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function createDefaultColumns(rows) {
  if (!rows.length) return [];

  return Object.keys(rows[0]).map((field) => ({
    field,
    headerName: createHeaderName(field),
    minWidth: 130,
    flex: 1,
    sortable: true,
    filter: true,
    resizable: true,
    tooltipField: field,
  }));
}

/**
 * Reusable operations table.
 *
 * The parent supplies real records and column definitions.
 * This component deliberately does not create sample payments,
 * incidents, amounts, statuses, or other business data.
 */
export default function OperationsGrid({
  title = "Operations",
  description = "Review and manage available records.",
  eyebrow = "OPERATIONS WORKSPACE",
  rowData = [],
  columnDefs,
  loading = false,
  error = "",
  emptyMessage = "No records are available to display.",
  searchPlaceholder = "Search records...",
  searchSeed = "",
  exportFileName = "resolveai-operations.csv",
  footerNote = "Data shown is limited to records supplied by ResolveAI.",
  onRowClicked,
  getRowId,
  pageSize = 10,
  className = "",
  compact = false,
  headerAction = null,
  selectedId = null,
}) {
  const gridRef = useRef(null);
  const [searchText, setSearchText] = useState(searchSeed || "");
  const [appliedSeed, setAppliedSeed] = useState(searchSeed || "");

  // Allow the application top bar search to seed this table's filter.
  if ((searchSeed || "") !== appliedSeed) {
    setAppliedSeed(searchSeed || "");
    setSearchText(searchSeed || "");
  }

  const safeRows = useMemo(
    () => (Array.isArray(rowData) ? rowData : []),
    [rowData],
  );

  const safeColumns = useMemo(() => {
    if (Array.isArray(columnDefs) && columnDefs.length > 0) {
      return columnDefs;
    }

    return createDefaultColumns(safeRows);
  }, [columnDefs, safeRows]);

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 110,
      flex: 1,
      suppressHeaderMenuButton: false,
    }),
    [],
  );

  const handleExport = () => {
    gridRef.current?.api?.exportDataAsCsv({
      fileName: exportFileName,
    });
  };

  const showEmptyState = !loading && !error && safeRows.length === 0;
  const controlsDisabled = loading || showEmptyState || Boolean(error);
  const usePagination = safeRows.length > pageSize;
  const pageSizeOptions = [...new Set([pageSize, 10, 20, 50])].sort(
    (a, b) => a - b,
  );

  return (
    <section
      className={`operations-grid-panel ${
        onRowClicked ? "operations-grid-clickable" : ""
      } ${compact ? "operations-grid-compact" : ""} ${className}`.trim()}
    >
      {compact && (
        <div className="operations-grid-header operations-grid-header-compact">
          <h2>{title}</h2>
          {headerAction}
        </div>
      )}

      {!compact && (<>
      <div className="operations-grid-header">
        <div className="operations-grid-heading">
          <div className="operations-grid-eyebrow">{eyebrow}</div>

          <h2>{title}</h2>

          <p>{description}</p>
        </div>

        <div className="operations-grid-count" aria-live="polite">
          <strong>{safeRows.length}</strong>
          <span>{safeRows.length === 1 ? "record" : "records"}</span>
        </div>
      </div>

      <div className="operations-grid-toolbar">
        <label
          className="operations-grid-search"
          htmlFor="operations-grid-search"
        >
          <span aria-hidden="true">⌕</span>

          <input
            id="operations-grid-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={searchPlaceholder}
            disabled={controlsDisabled}
          />
        </label>

        <button
          type="button"
          className="operations-grid-export"
          onClick={handleExport}
          disabled={controlsDisabled}
          title="Export the currently loaded records as CSV"
        >
          <span aria-hidden="true">↓</span>
          Export CSV
        </button>
      </div>
      </>)}

      {loading && (
        <div className="operations-grid-state" role="status">
          <span className="operations-grid-loader" />
          <strong>Loading records</strong>
          <p>Please wait while the operations data is retrieved.</p>
        </div>
      )}

      {!loading && error && (
        <div
          className="operations-grid-state operations-grid-state-error"
          role="alert"
        >
          <strong>Unable to load operations</strong>
          <p>{error}</p>
        </div>
      )}

      {showEmptyState && (
        <div className="operations-grid-state">
          <span className="operations-grid-empty-icon" aria-hidden="true">
            ◫
          </span>
          <strong>No records found</strong>
          <p>{emptyMessage}</p>
        </div>
      )}

      {!loading && !error && safeRows.length > 0 && (
        <div className="operations-grid-table">
          <AgGridReact
            ref={gridRef}
            theme={operationsTheme}
            rowData={safeRows}
            columnDefs={safeColumns}
            defaultColDef={defaultColDef}
            getRowId={getRowId}
            onRowClicked={onRowClicked}
            quickFilterText={searchText}
            pagination={usePagination}
            paginationPageSize={pageSize}
            paginationPageSizeSelector={pageSizeOptions}
            getRowClass={(params) =>
              selectedId !== null &&
              selectedId !== undefined &&
              String(params.data?.id) === String(selectedId)
                ? "operations-grid-row-selected"
                : undefined
            }
            animateRows
            suppressCellFocus
            domLayout="autoHeight"
          />
        </div>
      )}

      {!compact && (
        <div className="operations-grid-footer">
          <span>{footerNote}</span>
          <span>AG Grid Community</span>
        </div>
      )}
    </section>
  );
}
