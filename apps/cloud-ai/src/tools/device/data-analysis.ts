import { z } from 'zod';
import { makeLocalTool } from './shared';

// Common plot args shared by every chart-type tool
const PLOT_COMMON = {
  title: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  width: z.number().optional().describe('Figure width in inches (default 8)'),
  height: z.number().optional().describe('Figure height in inches (default 5)'),
  savePath: z.string().optional().describe('Absolute PNG output path. Auto-generated under ~/StuardAI/data_analysis/ if omitted.'),
  grid: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
} as const;

// ─── Infra ───────────────────────────────────────────────────────────────────

export const data_analysis_status = makeLocalTool(
  'data_analysis_status',
  'Report whether the data-analysis venv is created and all required packages (pandas, numpy, scipy, matplotlib, seaborn, openpyxl) are installed.',
  z.object({}),
  z.any(),
);

export const data_analysis_setup = makeLocalTool(
  'data_analysis_setup',
  'Create the data-analysis venv and install pandas/numpy/scipy/matplotlib/seaborn/openpyxl. Idempotent; ~400MB on first install.',
  z.object({}),
  z.any(),
  600000,
);

export const data_analysis_uninstall = makeLocalTool(
  'data_analysis_uninstall',
  'Remove the data-analysis venv. Frees ~400MB of disk.',
  z.object({}),
  z.any(),
  120000,
);

// ─── Data understanding ──────────────────────────────────────────────────────

export const data_load = makeLocalTool(
  'data_load',
  'Peek at a data file (CSV/TSV/XLSX/JSON/Parquet): returns columns, dtypes, shape, sample rows, and null counts. Use this BEFORE plotting to confirm column names.',
  z.object({
    path: z.string().describe('Absolute path to .csv, .tsv, .xlsx, .xls, .json, or .parquet'),
    sheet: z.string().optional().describe('Sheet name for .xlsx'),
    sampleRows: z.number().int().min(1).max(500).optional().describe('Rows to return in sample (default 10)'),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  }),
  z.any(),
);

export const describe_data = makeLocalTool(
  'describe_data',
  'Pandas describe()-style summary stats (count/mean/std/min/quartiles/max) for numeric columns of a file or inline data.',
  z.object({
    path: z.string().optional().describe('Data file path. Provide this OR `data`.'),
    data: z.array(z.any()).optional().describe('Inline array of row objects (alternative to path).'),
    columns: z.array(z.string()).optional().describe('Subset of columns to describe.'),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  }),
  z.any(),
);

export const correlate_data = makeLocalTool(
  'correlate_data',
  'Correlation matrix for numeric columns. Methods: pearson (default), spearman, kendall.',
  z.object({
    path: z.string().optional().describe('Data file path. Provide this OR `data`.'),
    data: z.array(z.any()).optional().describe('Inline array of row objects (alternative to path).'),
    columns: z.array(z.string()).optional(),
    method: z.enum(['pearson', 'spearman', 'kendall']).optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  }),
  z.any(),
);

// ─── Visualization ───────────────────────────────────────────────────────────

export const plot_line = makeLocalTool(
  'plot_line',
  'Line chart (single or multi-series). Saves a PNG and returns its absolute path.',
  z.object({
    data: z.array(z.number()).optional().describe('Single-series numeric array.'),
    series: z
      .array(
        z.object({
          name: z.string().optional(),
          data: z.union([
            z.array(z.number()),
            z.array(z.object({ x: z.any(), y: z.number() })),
          ]),
          marker: z.string().optional(),
        }),
      )
      .optional()
      .describe('Multi-series. Each item is { name?, data: number[] | [{x,y},...], marker? }.'),
    name: z.string().optional(),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_bar = makeLocalTool(
  'plot_bar',
  'Bar chart (vertical or horizontal). Saves a PNG and returns its absolute path.',
  z.object({
    data: z
      .union([
        z.array(z.number()),
        z.array(z.object({ label: z.string(), value: z.number() })),
      ])
      .describe('Either a numeric array or [{label,value},...].'),
    labels: z.array(z.string()).optional(),
    color: z.string().optional().describe('Hex color, e.g. #4f46e5'),
    horizontal: z.boolean().optional(),
    rotation: z.number().optional().describe('X-tick rotation in degrees'),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_scatter = makeLocalTool(
  'plot_scatter',
  'Scatter plot. Each point may carry its own size/color. Optional linear regression overlay.',
  z.object({
    data: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          size: z.number().optional(),
          color: z.string().optional(),
        }),
      )
      .describe('Points as [{x, y, size?, color?}, ...]'),
    color: z.string().optional().describe('Default marker color (hex).'),
    regression: z.boolean().optional().describe('Overlay y = mx+b regression line.'),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_hist = makeLocalTool(
  'plot_hist',
  'Histogram of a numeric array. Optional KDE overlay via seaborn.',
  z.object({
    data: z.array(z.number()),
    bins: z.number().int().min(2).max(500).optional(),
    color: z.string().optional(),
    kde: z.boolean().optional(),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_pie = makeLocalTool(
  'plot_pie',
  'Pie or donut chart. Pass either a number[] (with labels[]) or [{label,value},...].',
  z.object({
    data: z.union([
      z.array(z.number()),
      z.array(z.object({ label: z.string(), value: z.number() })),
    ]),
    labels: z.array(z.string()).optional(),
    donut: z.boolean().optional(),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_heatmap = makeLocalTool(
  'plot_heatmap',
  'Heatmap from a 2D matrix (e.g. correlation matrix). Optionally annotate cells with values.',
  z.object({
    data: z.array(z.array(z.number())).describe('2D number matrix.'),
    xTicks: z.array(z.string()).optional(),
    yTicks: z.array(z.string()).optional(),
    cmap: z.string().optional().describe('Matplotlib colormap name (default viridis).'),
    annot: z.boolean().optional(),
    ...PLOT_COMMON,
  }),
  z.any(),
);

export const plot_box = makeLocalTool(
  'plot_box',
  'Box plot. Pass a number[] for a single box, or [{label, values:number[]},...] for grouped boxes.',
  z.object({
    data: z.union([
      z.array(z.number()),
      z.array(z.object({ label: z.string(), values: z.array(z.number()) })),
    ]),
    notch: z.boolean().optional(),
    ...PLOT_COMMON,
  }),
  z.any(),
);

// ─── Escape hatch ────────────────────────────────────────────────────────────

export const run_data_python = makeLocalTool(
  'run_data_python',
  'Run arbitrary Python in the data-analysis venv. pd/np/sp/plt/sns are pre-imported. A pre-set `output_path` variable is in scope — save your figure to it. Returns stdout, stderr, and outputPath if the file was written.',
  z.object({
    code: z.string().describe('Python source. Save any figure with `fig.savefig(output_path)` or `plt.savefig(output_path)`.'),
    outputPath: z.string().optional().describe('Suggested PNG output path (auto-generated under ~/StuardAI/data_analysis/ if omitted).'),
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
  }),
  z.object({
    ok: z.boolean().optional(),
    exitCode: z.number().int().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    outputPath: z.string().nullable().optional(),
  }),
  (ctx) => {
    const ms = Number((ctx as any)?.timeoutMs);
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms + 15000, 300000) : 60000;
  },
);
