/**
 * UI Builder Type Definitions
 * Visual UI designer for creating custom_ui tool arguments
 */

// === Element Types ===

export type UIElementType =
  | 'button'
  | 'input'
  | 'textarea'
  | 'text'
  | 'heading'
  | 'image'
  | 'icon'
  | 'container'
  | 'row'
  | 'column'
  | 'grid'
  | 'divider'
  | 'spacer'
  | 'checkbox'
  | 'select'
  | 'slider'
  | 'badge'
  | 'progress'
  | 'card'
  | 'thumbnail-grid'
  | 'file-list'
  | 'data-table'
  | 'code-block';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
export type TextAlign = 'left' | 'center' | 'right';
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold';
export type ShadowSize = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type LayoutMode = 'free' | 'flex-row' | 'flex-col' | 'grid';
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch';
export type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// === Element Interfaces ===

export interface UIElementStyle {
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  padding?: number | [number, number, number, number];
  margin?: number | [number, number, number, number];
  fontSize?: number;
  fontWeight?: FontWeight;
  textAlign?: TextAlign;
  shadow?: ShadowSize;
  opacity?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface UIElementBindings {
  dataBind?: string;      // data-bind attribute for syncing with workflow data
  dataAction?: string;    // data-action attribute (submit, cancel, custom action name)
  onClick?: string;       // JavaScript code to execute on click
  onInput?: string;       // JavaScript code to execute on input change
  dataHtml?: boolean;     // data-html attribute - render text as HTML
  dataValidate?: string;  // Validation expression
}

export interface UIElementProps {
  // Common props
  text?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;

  // Button-specific
  variant?: ButtonVariant;
  icon?: string;
  iconPosition?: 'left' | 'right';

  // Input-specific
  inputType?: 'text' | 'number' | 'email' | 'password' | 'url' | 'tel';
  required?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;

  // Image-specific
  src?: string;
  alt?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none';

  // Heading-specific
  level?: HeadingLevel;

  // Select-specific
  options?: Array<{ value: string; label: string }>;
  multiple?: boolean;

  // Slider-specific
  min?: number;
  max?: number;
  step?: number;

  // Progress-specific
  value?: number;
  showLabel?: boolean;

  // Badge-specific
  color?: 'gray' | 'red' | 'yellow' | 'green' | 'blue' | 'indigo' | 'purple' | 'pink';

  // Code-block-specific
  language?: string;

  // Grid-specific
  columns?: number;
  rows?: number;

  // Thumbnail-grid specific
  imageUrls?: string[];

  // File-list specific
  files?: Array<{ name: string; path: string; size?: number }>;

  // Data-table specific
  headers?: string[];
  data?: any[][];

  // Generic custom props
  [key: string]: any;
}

export interface UIElement {
  id: string;
  type: UIElementType;

  // Position & Size (relative to parent for free layout, ignored for flex/grid)
  x: number;
  y: number;
  width: number | 'auto' | 'full';
  height: number | 'auto' | 'full';

  // Content properties
  props: UIElementProps;

  // Styling
  style: UIElementStyle;

  // Workflow data bindings
  bindings: UIElementBindings;

  // Children (for containers: container, row, column, grid, card)
  children?: UIElement[];

  // Layout mode for containers
  layout?: LayoutMode;
  gap?: number;
  alignItems?: FlexAlign;
  justifyContent?: FlexJustify;

  // Grid-specific layout
  gridCols?: number;
  gridRows?: number;

  // For elements in a grid layout - which cell(s) they occupy
  gridColumn?: string;  // e.g., "1 / 3" or "span 2"
  gridRow?: string;

  // Flex-specific
  flexGrow?: number;
  flexShrink?: number;

  // Z-index for free layout overlapping
  zIndex?: number;

  // Lock element from editing
  locked?: boolean;

  // Name for the layer panel
  name?: string;
}

// === Design Document ===

export interface UICanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  padding?: number;
  gridSize?: number;      // Grid snap size (8, 16, 24)
  showGrid?: boolean;
  showRulers?: boolean;
}

export interface UIWindowConfig {
  width: number;
  height: number;
  position: 'center' | 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'mouse';
  alwaysOnTop: boolean;
  frameless: boolean;
  transparent: boolean;
  borderRadius: number;
  resizable?: boolean;
  minimizable?: boolean;
  closable?: boolean;
  title?: string;
}

export interface UIDesign {
  id: string;
  name: string;
  version: string;

  // Canvas settings
  canvas: UICanvasConfig;

  // Root elements
  elements: UIElement[];

  // Global CSS (optional custom styles)
  customCss?: string;

  // Global JavaScript (optional custom code)
  customScript?: string;

  // Window configuration for custom_ui tool
  windowConfig: UIWindowConfig;

  // Metadata
  createdAt?: string;
  updatedAt?: string;

  // Tags for organization
  tags?: string[];
}

// === Palette Component Definition ===

export interface PaletteComponentDef {
  type: UIElementType;
  label: string;
  icon: string;
  description?: string;
  category: 'layout' | 'input' | 'display' | 'special';

  // Default values when dropped
  defaultWidth: number | 'auto' | 'full';
  defaultHeight: number | 'auto' | 'full';
  defaultProps: Partial<UIElementProps>;
  defaultStyle: Partial<UIElementStyle>;
  defaultLayout?: LayoutMode;

  // For containers, allow children
  allowChildren?: boolean;

  // Minimum dimensions
  minWidth?: number;
  minHeight?: number;
}

// === Selection & Editing State ===

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeHandle {
  position: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  cursor: string;
}

export interface DragState {
  isDragging: boolean;
  dragType: 'move' | 'resize' | 'create' | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  elementId?: string;
  resizeHandle?: ResizeHandle['position'];
  paletteItem?: PaletteComponentDef;
}

export interface UIBuilderState {
  design: UIDesign;
  selectedIds: string[];
  hoveredId: string | null;
  clipboard: UIElement[];
  history: UIDesign[];
  historyIndex: number;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  previewMode: boolean;
}

// === Actions ===

export type UIBuilderAction =
  | { type: 'SET_DESIGN'; design: UIDesign }
  | { type: 'SELECT'; ids: string[]; add?: boolean }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'HOVER'; id: string | null }
  | { type: 'ADD_ELEMENT'; element: UIElement; parentId?: string }
  | { type: 'UPDATE_ELEMENT'; id: string; updates: Partial<UIElement> }
  | { type: 'DELETE_ELEMENTS'; ids: string[] }
  | { type: 'MOVE_ELEMENTS'; ids: string[]; dx: number; dy: number }
  | { type: 'RESIZE_ELEMENT'; id: string; width: number; height: number; x?: number; y?: number }
  | { type: 'DUPLICATE_ELEMENTS'; ids: string[] }
  | { type: 'COPY' }
  | { type: 'PASTE'; x?: number; y?: number }
  | { type: 'BRING_FORWARD'; id: string }
  | { type: 'SEND_BACKWARD'; id: string }
  | { type: 'BRING_TO_FRONT'; id: string }
  | { type: 'SEND_TO_BACK'; id: string }
  | { type: 'GROUP'; ids: string[] }
  | { type: 'UNGROUP'; id: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_PAN'; x: number; y: number }
  | { type: 'TOGGLE_GRID' }
  | { type: 'TOGGLE_SNAP' }
  | { type: 'SET_GRID_SIZE'; size: number }
  | { type: 'TOGGLE_RULERS' }
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'UPDATE_CANVAS'; canvas: Partial<UICanvasConfig> }
  | { type: 'UPDATE_WINDOW_CONFIG'; config: Partial<UIWindowConfig> }
  | { type: 'SET_CUSTOM_CSS'; css: string }
  | { type: 'SET_CUSTOM_SCRIPT'; script: string };

// === Generated Output ===

export interface GeneratedCode {
  html: string;
  css: string;
  js: string;
  fullHtml: string;  // Complete HTML document with inline CSS and JS
}

// === UI Builder Props ===

export interface UIBuilderModalProps {
  initialDesign?: Partial<UIDesign>;
  onSave: (design: UIDesign, code: GeneratedCode) => void;
  onClose: () => void;
  isOpen?: boolean;
}

// === Helper Types ===

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Point for coordinate calculations
export interface Point {
  x: number;
  y: number;
}

// Rectangle bounds
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Alignment guide for snapping
export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  source: 'element' | 'canvas' | 'grid';
}
