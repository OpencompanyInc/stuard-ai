/**
 * Palette Component Definitions
 * Defines all available components that can be dragged onto the canvas
 */

import type { PaletteComponentDef, UIElementType } from '../types';

// === Layout Components ===

export const containerDef: PaletteComponentDef = {
  type: 'container',
  label: 'Container',
  icon: 'Square',
  description: 'Generic container with configurable layout',
  category: 'layout',
  defaultWidth: 300,
  defaultHeight: 200,
  defaultProps: {},
  defaultStyle: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
  },
  defaultLayout: 'flex-col',
  allowChildren: true,
  minWidth: 50,
  minHeight: 50,
};

export const rowDef: PaletteComponentDef = {
  type: 'row',
  label: 'Row',
  icon: 'LayoutList',
  description: 'Horizontal flex container',
  category: 'layout',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {},
  defaultStyle: {
    padding: 8,
  },
  defaultLayout: 'flex-row',
  allowChildren: true,
  minWidth: 100,
  minHeight: 40,
};

export const columnDef: PaletteComponentDef = {
  type: 'column',
  label: 'Column',
  icon: 'LayoutGrid',
  description: 'Vertical flex container',
  category: 'layout',
  defaultWidth: 'auto',
  defaultHeight: 'full',
  defaultProps: {},
  defaultStyle: {
    padding: 8,
  },
  defaultLayout: 'flex-col',
  allowChildren: true,
  minWidth: 40,
  minHeight: 100,
};

export const gridDef: PaletteComponentDef = {
  type: 'grid',
  label: 'Grid',
  icon: 'Grid3x3',
  description: 'CSS Grid layout container',
  category: 'layout',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {
    columns: 3,
    rows: 2,
  },
  defaultStyle: {
    padding: 8,
  },
  defaultLayout: 'grid',
  allowChildren: true,
  minWidth: 100,
  minHeight: 100,
};

export const cardDef: PaletteComponentDef = {
  type: 'card',
  label: 'Card',
  icon: 'CreditCard',
  description: 'Styled card container with shadow',
  category: 'layout',
  defaultWidth: 300,
  defaultHeight: 'auto',
  defaultProps: {},
  defaultStyle: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadow: 'md',
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  defaultLayout: 'flex-col',
  allowChildren: true,
  minWidth: 100,
  minHeight: 60,
};

export const spacerDef: PaletteComponentDef = {
  type: 'spacer',
  label: 'Spacer',
  icon: 'MoveVertical',
  description: 'Flexible empty space',
  category: 'layout',
  defaultWidth: 'auto',
  defaultHeight: 24,
  defaultProps: {},
  defaultStyle: {},
};

export const dividerDef: PaletteComponentDef = {
  type: 'divider',
  label: 'Divider',
  icon: 'Minus',
  description: 'Horizontal or vertical line separator',
  category: 'layout',
  defaultWidth: 'full',
  defaultHeight: 1,
  defaultProps: {},
  defaultStyle: {
    backgroundColor: '#e2e8f0',
  },
};

// === Input Components ===

export const buttonDef: PaletteComponentDef = {
  type: 'button',
  label: 'Button',
  icon: 'MousePointerClick',
  description: 'Clickable button with variants',
  category: 'input',
  defaultWidth: 'auto',
  defaultHeight: 'auto',
  defaultProps: {
    text: 'Button',
    variant: 'primary',
  },
  defaultStyle: {
    borderRadius: 8,
    padding: [10, 20, 10, 20],
    fontWeight: 'semibold',
  },
  minWidth: 60,
  minHeight: 32,
};

export const inputDef: PaletteComponentDef = {
  type: 'input',
  label: 'Text Input',
  icon: 'TextCursor',
  description: 'Single-line text input field',
  category: 'input',
  defaultWidth: 240,
  defaultHeight: 'auto',
  defaultProps: {
    placeholder: 'Enter text...',
    inputType: 'text',
  },
  defaultStyle: {
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: [10, 12, 10, 12],
  },
  minWidth: 100,
  minHeight: 36,
};

export const textareaDef: PaletteComponentDef = {
  type: 'textarea',
  label: 'Text Area',
  icon: 'AlignLeft',
  description: 'Multi-line text input',
  category: 'input',
  defaultWidth: 280,
  defaultHeight: 120,
  defaultProps: {
    placeholder: 'Enter text...',
  },
  defaultStyle: {
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: 12,
  },
  minWidth: 100,
  minHeight: 60,
};

export const checkboxDef: PaletteComponentDef = {
  type: 'checkbox',
  label: 'Checkbox',
  icon: 'CheckSquare',
  description: 'Toggle checkbox with label',
  category: 'input',
  defaultWidth: 'auto',
  defaultHeight: 'auto',
  defaultProps: {
    text: 'Check me',
  },
  defaultStyle: {},
  minWidth: 80,
  minHeight: 24,
};

export const selectDef: PaletteComponentDef = {
  type: 'select',
  label: 'Select',
  icon: 'ChevronDown',
  description: 'Dropdown select menu',
  category: 'input',
  defaultWidth: 200,
  defaultHeight: 'auto',
  defaultProps: {
    options: [
      { value: 'option1', label: 'Option 1' },
      { value: 'option2', label: 'Option 2' },
      { value: 'option3', label: 'Option 3' },
    ],
  },
  defaultStyle: {
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: [10, 12, 10, 12],
  },
  minWidth: 100,
  minHeight: 36,
};

export const sliderDef: PaletteComponentDef = {
  type: 'slider',
  label: 'Slider',
  icon: 'SlidersHorizontal',
  description: 'Range slider input',
  category: 'input',
  defaultWidth: 200,
  defaultHeight: 'auto',
  defaultProps: {
    min: 0,
    max: 100,
    step: 1,
  },
  defaultStyle: {},
  minWidth: 100,
  minHeight: 32,
};

// === Display Components ===

export const textDef: PaletteComponentDef = {
  type: 'text',
  label: 'Text',
  icon: 'Type',
  description: 'Static or dynamic text',
  category: 'display',
  defaultWidth: 'auto',
  defaultHeight: 'auto',
  defaultProps: {
    text: 'Text content',
  },
  defaultStyle: {
    fontSize: 14,
  },
  minWidth: 20,
  minHeight: 16,
};

export const headingDef: PaletteComponentDef = {
  type: 'heading',
  label: 'Heading',
  icon: 'Heading',
  description: 'H1-H6 headings',
  category: 'display',
  defaultWidth: 'auto',
  defaultHeight: 'auto',
  defaultProps: {
    text: 'Heading',
    level: 2,
  },
  defaultStyle: {
    fontWeight: 'bold',
  },
  minWidth: 40,
  minHeight: 20,
};

export const imageDef: PaletteComponentDef = {
  type: 'image',
  label: 'Image',
  icon: 'Image',
  description: 'Image with src binding',
  category: 'display',
  defaultWidth: 200,
  defaultHeight: 150,
  defaultProps: {
    alt: 'Image',
    objectFit: 'cover',
  },
  defaultStyle: {
    borderRadius: 8,
  },
  minWidth: 40,
  minHeight: 40,
};

export const iconDef: PaletteComponentDef = {
  type: 'icon',
  label: 'Icon',
  icon: 'Smile',
  description: 'Lucide icon',
  category: 'display',
  defaultWidth: 24,
  defaultHeight: 24,
  defaultProps: {
    icon: 'Star',
  },
  defaultStyle: {
    textColor: '#64748b',
  },
  minWidth: 16,
  minHeight: 16,
};

export const badgeDef: PaletteComponentDef = {
  type: 'badge',
  label: 'Badge',
  icon: 'Tag',
  description: 'Status badge / tag',
  category: 'display',
  defaultWidth: 'auto',
  defaultHeight: 'auto',
  defaultProps: {
    text: 'Badge',
    color: 'blue',
  },
  defaultStyle: {
    borderRadius: 9999,
    padding: [4, 12, 4, 12],
    fontSize: 12,
    fontWeight: 'medium',
  },
  minWidth: 30,
  minHeight: 20,
};

export const progressDef: PaletteComponentDef = {
  type: 'progress',
  label: 'Progress Bar',
  icon: 'Activity',
  description: 'Progress indicator',
  category: 'display',
  defaultWidth: 200,
  defaultHeight: 8,
  defaultProps: {
    value: 60,
    showLabel: false,
  },
  defaultStyle: {
    borderRadius: 4,
  },
  minWidth: 60,
  minHeight: 4,
};

// === Special Components ===

export const thumbnailGridDef: PaletteComponentDef = {
  type: 'thumbnail-grid',
  label: 'Thumbnail Grid',
  icon: 'LayoutGrid',
  description: 'Image gallery grid',
  category: 'special',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {
    columns: 4,
  },
  defaultStyle: {
    padding: 8,
  },
  minWidth: 200,
  minHeight: 100,
};

export const fileListDef: PaletteComponentDef = {
  type: 'file-list',
  label: 'File List',
  icon: 'FileText',
  description: 'List of files with icons',
  category: 'special',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {},
  defaultStyle: {
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  minWidth: 150,
  minHeight: 60,
};

export const dataTableDef: PaletteComponentDef = {
  type: 'data-table',
  label: 'Data Table',
  icon: 'Table',
  description: 'Simple data table',
  category: 'special',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {
    headers: ['Column 1', 'Column 2', 'Column 3'],
    data: [
      ['Row 1 Col 1', 'Row 1 Col 2', 'Row 1 Col 3'],
      ['Row 2 Col 1', 'Row 2 Col 2', 'Row 2 Col 3'],
    ],
  },
  defaultStyle: {
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  minWidth: 200,
  minHeight: 80,
};

export const codeBlockDef: PaletteComponentDef = {
  type: 'code-block',
  label: 'Code Block',
  icon: 'Code2',
  description: 'Syntax-highlighted code',
  category: 'special',
  defaultWidth: 'full',
  defaultHeight: 'auto',
  defaultProps: {
    text: '// Code here',
    language: 'javascript',
  },
  defaultStyle: {
    backgroundColor: '#1e293b',
    textColor: '#e2e8f0',
    borderRadius: 8,
    padding: 16,
    fontSize: 13,
  },
  minWidth: 150,
  minHeight: 60,
};

// === All Palette Components ===

export const PALETTE_COMPONENTS: PaletteComponentDef[] = [
  // Layout
  containerDef,
  rowDef,
  columnDef,
  gridDef,
  cardDef,
  spacerDef,
  dividerDef,
  // Input
  buttonDef,
  inputDef,
  textareaDef,
  checkboxDef,
  selectDef,
  sliderDef,
  // Display
  textDef,
  headingDef,
  imageDef,
  iconDef,
  badgeDef,
  progressDef,
  // Special
  thumbnailGridDef,
  fileListDef,
  dataTableDef,
  codeBlockDef,
];

// Group by category
export const PALETTE_BY_CATEGORY = {
  layout: PALETTE_COMPONENTS.filter(c => c.category === 'layout'),
  input: PALETTE_COMPONENTS.filter(c => c.category === 'input'),
  display: PALETTE_COMPONENTS.filter(c => c.category === 'display'),
  special: PALETTE_COMPONENTS.filter(c => c.category === 'special'),
};

// Get component definition by type
export function getComponentDef(type: UIElementType): PaletteComponentDef | undefined {
  return PALETTE_COMPONENTS.find(c => c.type === type);
}
