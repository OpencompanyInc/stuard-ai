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
export type FontWeight = 'thin' | 'extralight' | 'light' | 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';
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
  fontFamily?: string;
  fontWeight?: FontWeight;
  fontStyle?: 'normal' | 'italic';
  textAlign?: TextAlign;
  letterSpacing?: number;  // em units (e.g. -0.05, 0, 0.025, 0.05, 0.1)
  lineHeight?: number;     // unitless multiplier (e.g. 1, 1.25, 1.5, 2)
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
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
  position: 'center' | 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'bottomcenter' | 'mouse' | 'cursor' | 'custom';
  customX?: number;
  customY?: number;
  alwaysOnTop: boolean;
  frameless: boolean;
  transparent: boolean;
  borderRadius: number;
  resizable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  closable?: boolean;
  draggable?: boolean;
  skipTaskbar?: boolean;
  title?: string;

  // === ENHANCED WINDOW APPEARANCE ===
  // Background type: solid color, gradient, image, translucent (semi-transparent), or fully transparent
  backgroundType?: 'color' | 'gradient' | 'image' | 'translucent' | 'transparent';

  // Translucent background configuration
  translucent?: {
    color: string;       // Base color (hex)
    opacity: number;     // 0-1 (e.g. 0.7 = 70% opaque)
    blur?: number;       // Backdrop blur in px (frosted glass effect)
    vibrancy?: boolean;  // Enable vibrancy/mica effect on supported platforms
  };

  // Solid color background (hex, rgb, rgba)
  backgroundColor?: string;

  // Gradient background configuration
  gradient?: {
    type: 'linear' | 'radial' | 'conic';
    angle?: number; // For linear gradient (degrees)
    stops: Array<{
      color: string;
      position: number; // 0-100
    }>;
    centerX?: number; // For radial/conic (0-100)
    centerY?: number; // For radial/conic (0-100)
  };

  // Image background configuration
  backgroundImage?: {
    url: string;
    fit: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    position: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    repeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
    opacity?: number; // 0-1
  };

  // Overlay for better text readability over images/gradients
  overlay?: {
    enabled: boolean;
    color: string; // rgba color
    blur?: number; // backdrop blur in px
  };

  // Window shadow
  shadow?: {
    enabled: boolean;
    color: string;
    blur: number;
    spread: number;
    x: number;
    y: number;
  };

  // Border styling
  border?: {
    enabled: boolean;
    color: string;
    width: number;
    style: 'solid' | 'dashed' | 'dotted';
  };

  // Animation
  animation?: {
    open?: 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'scale' | 'none';
    close?: 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'scale' | 'none';
    duration: number; // ms
    easing: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear';
  };

  // Content overflow / scrollbar behavior
  overflow?: 'auto' | 'hidden' | 'scroll' | 'visible';

  // Content padding
  contentPadding?: number;

  // Typography defaults
  typography?: {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    color?: string;
  };
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

  // React-like state variables for the UI
  stateVariables?: UIStateVariable[];

  // No-code tool actions (call tools from UI without writing code)
  toolActions?: UIToolAction[];
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

// === STATE MANAGEMENT (React-like useState) ===

export type UIStateVarType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface UIStateVariable {
  id: string;
  name: string;              // Variable name (e.g., "count", "isLoading", "searchResults")
  type: UIStateVarType;
  defaultValue: any;         // Default value
  description?: string;      // Optional description
}

export interface UIToolAction {
  id: string;
  name: string;              // Display name for the action
  toolName: string;          // Tool to call (e.g., "web_search", "log")
  args: Record<string, any>; // Static args or state refs like "$state.query"
  resultVar?: string;        // State variable to store result in
  loadingVar?: string;       // State variable to track loading
  errorVar?: string;         // State variable to store error
  trigger: 'click' | 'load' | 'stateChange';
  triggerConfig?: {
    elementId?: string;      // For click trigger - which element triggers this
    stateVar?: string;       // For stateChange trigger
    debounceMs?: number;
  };
}

// Element breadcrumb for hierarchy navigation
export interface ElementBreadcrumb {
  path: string;
  tagName: string;
  label: string;           // Display label (tag + id/class)
}

// === PAGE SYSTEM ===

export interface UIPage {
  id: string;
  name: string;
  title?: string;
  html: string;
  css?: string;
  js?: string;
  // Page-specific window overrides
  windowConfig?: Partial<UIWindowConfig>;
  // Navigation rules
  navigation?: {
    // Actions that trigger navigation to this page
    triggers?: Array<{
      action: string;
      condition?: string; // Optional condition expression
    }>;
    // Timeout auto-navigation
    autoNavigate?: {
      delayMs: number;
      targetPage: string;
      condition?: string;
    };
  };
}

export interface UIPageFlow {
  pages: Record<string, UIPage>;
  startPage: string;
  // Global navigation handlers
  onAction?: Record<string, {
    targetPage: string;
    condition?: string;
    dataMapping?: Record<string, string>; // Map form data to page data
  }>;
}

export interface PageFlowNode {
  id: string;
  pageId: string;
  x: number;
  y: number;
  // Outgoing connections (action -> target page)
  connections: Array<{
    action: string;
    targetNodeId: string;
    condition?: string;
    label?: string;
  }>;
}

export interface PageFlowDesign {
  nodes: PageFlowNode[];
  startNodeId: string;
}

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
