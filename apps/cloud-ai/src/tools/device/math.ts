/**
 * Math & Neural Network Operations
 * Provides arithmetic, matrix, and activation function tools for building
 * mini neural networks and mathematical computations within workflows.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool } from '../bridge';

// A scalar or an N-dimensional numeric tensor. Expressed as a few concrete
// nesting levels (up to 4D) instead of `z.array(z.any())` so the schema stays
// fully typed — strict providers like Gemini reject typeless array items.
const TensorSchema: z.ZodTypeAny = z.union([
  z.number(),
  z.array(z.number()),
  z.array(z.array(z.number())),
  z.array(z.array(z.array(z.number()))),
  z.array(z.array(z.array(z.array(z.number())))),
]);

const ResultSchema = z.object({
  ok: z.boolean(),
  result: z.any().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Basic Arithmetic
// ============================================================================

export const math_add = createTool({
  id: 'math_add',
  description: 'Add two values/tensors elementwise. Supports scalars and nested arrays.',
  inputSchema: z.object({
    a: TensorSchema.describe('First operand'),
    b: TensorSchema.describe('Second operand'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_add', inputData),
});

export const math_subtract = createTool({
  id: 'math_subtract',
  description: 'Subtract b from a elementwise. Supports scalars and nested arrays.',
  inputSchema: z.object({
    a: TensorSchema.describe('First operand'),
    b: TensorSchema.describe('Second operand (subtracted from a)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_subtract', inputData),
});

export const math_multiply = createTool({
  id: 'math_multiply',
  description: 'Multiply two values/tensors elementwise. Supports scalars and nested arrays.',
  inputSchema: z.object({
    a: TensorSchema.describe('First operand'),
    b: TensorSchema.describe('Second operand'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_multiply', inputData),
});

export const math_divide = createTool({
  id: 'math_divide',
  description: 'Divide a by b elementwise. Supports scalars and nested arrays.',
  inputSchema: z.object({
    a: TensorSchema.describe('Numerator'),
    b: TensorSchema.describe('Denominator'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_divide', inputData),
});

export const math_power = createTool({
  id: 'math_power',
  description: 'Raise a to power b elementwise.',
  inputSchema: z.object({
    a: TensorSchema.describe('Base'),
    b: TensorSchema.describe('Exponent'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_power', inputData),
});

export const math_sqrt = createTool({
  id: 'math_sqrt',
  description: 'Square root elementwise.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_sqrt', inputData),
});

export const math_abs = createTool({
  id: 'math_abs',
  description: 'Absolute value elementwise.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_abs', inputData),
});

export const math_negate = createTool({
  id: 'math_negate',
  description: 'Negate values elementwise (multiply by -1).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_negate', inputData),
});

export const math_exp = createTool({
  id: 'math_exp',
  description: 'Exponential (e^x) elementwise.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_exp', inputData),
});

export const math_log = createTool({
  id: 'math_log',
  description: 'Natural logarithm elementwise.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_log', inputData),
});

// ============================================================================
// Aggregation Operations
// ============================================================================

export const math_sum = createTool({
  id: 'math_sum',
  description: 'Sum all elements or along a specific axis.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    axis: z.number().int().optional().describe('Axis to sum along (omit for total sum)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_sum', inputData),
});

export const math_mean = createTool({
  id: 'math_mean',
  description: 'Mean of all elements or along a specific axis.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    axis: z.number().int().optional().describe('Axis to compute mean along'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_mean', inputData),
});

export const math_max = createTool({
  id: 'math_max',
  description: 'Maximum value in tensor.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_max', inputData),
});

export const math_min = createTool({
  id: 'math_min',
  description: 'Minimum value in tensor.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_min', inputData),
});

export const math_argmax = createTool({
  id: 'math_argmax',
  description: 'Index of maximum value (flattened).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_argmax', inputData),
});

export const math_argmin = createTool({
  id: 'math_argmin',
  description: 'Index of minimum value (flattened).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_argmin', inputData),
});

// ============================================================================
// Matrix Operations
// ============================================================================

export const math_dot = createTool({
  id: 'math_dot',
  description: 'Dot product / matrix multiplication. 1D×1D=scalar, 2D×1D=vector, 2D×2D=matrix.',
  inputSchema: z.object({
    a: TensorSchema.describe('First matrix/vector'),
    b: TensorSchema.describe('Second matrix/vector'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_dot', inputData),
});

export const math_transpose = createTool({
  id: 'math_transpose',
  description: 'Transpose a 2D matrix.',
  inputSchema: z.object({
    x: z.array(z.array(z.number())).describe('2D matrix'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_transpose', inputData),
});

export const math_reshape = createTool({
  id: 'math_reshape',
  description: 'Reshape tensor to new shape (total elements must match).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    shape: z.array(z.number().int()).describe('New shape, e.g., [2, 3] for 2×3 matrix'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_reshape', inputData),
});

export const math_shape = createTool({
  id: 'math_shape',
  description: 'Get shape of a tensor as array of dimensions.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_shape', inputData),
});

export const math_flatten = createTool({
  id: 'math_flatten',
  description: 'Flatten tensor to 1D array.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_flatten', inputData),
});

// ============================================================================
// Tensor Creation
// ============================================================================

export const math_zeros = createTool({
  id: 'math_zeros',
  description: 'Create tensor filled with zeros.',
  inputSchema: z.object({
    shape: z.array(z.number().int()).describe('Shape of tensor, e.g., [3, 4] for 3×4 matrix'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_zeros', inputData),
});

export const math_ones = createTool({
  id: 'math_ones',
  description: 'Create tensor filled with ones.',
  inputSchema: z.object({
    shape: z.array(z.number().int()).describe('Shape of tensor'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_ones', inputData),
});

export const math_random = createTool({
  id: 'math_random',
  description: 'Generate a random number between min and max (inclusive).',
  inputSchema: z.object({
    min: z.number().optional().default(1).describe('Minimum value'),
    max: z.number().optional().default(10).describe('Maximum value'),
    integer: z.boolean().optional().default(true).describe('Return integer (true) or decimal (false)'),
    seed: z.number().int().optional().describe('Random seed for reproducibility'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_random', inputData),
});

export const math_range = createTool({
  id: 'math_range',
  description: 'Create a range of values [start, stop) with step.',
  inputSchema: z.object({
    start: z.number().default(0).describe('Start value'),
    stop: z.number().describe('Stop value (exclusive)'),
    step: z.number().default(1).describe('Step size'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_range', inputData),
});

export const math_linspace = createTool({
  id: 'math_linspace',
  description: 'Create linearly spaced values between start and stop.',
  inputSchema: z.object({
    start: z.number().describe('Start value'),
    stop: z.number().describe('Stop value'),
    num: z.number().int().default(10).describe('Number of values'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_linspace', inputData),
});

// ============================================================================
// Activation Functions (Neural Networks)
// ============================================================================

export const math_sigmoid = createTool({
  id: 'math_sigmoid',
  description: 'Sigmoid activation: 1/(1+e^-x). Maps to (0, 1).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_sigmoid', inputData),
});

export const math_relu = createTool({
  id: 'math_relu',
  description: 'ReLU activation: max(0, x). Most common activation in neural networks.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_relu', inputData),
});

export const math_leaky_relu = createTool({
  id: 'math_leaky_relu',
  description: 'Leaky ReLU: x if x>0 else alpha×x. Prevents dying neurons.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
    alpha: z.number().default(0.01).describe('Slope for negative values'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_leaky_relu', inputData),
});

export const math_tanh = createTool({
  id: 'math_tanh',
  description: 'Tanh activation. Maps to (-1, 1).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_tanh', inputData),
});

export const math_softmax = createTool({
  id: 'math_softmax',
  description: 'Softmax activation for classification. Converts logits to probabilities that sum to 1.',
  inputSchema: z.object({
    x: z.array(z.number()).describe('Input vector of logits'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_softmax', inputData),
});

export const math_gelu = createTool({
  id: 'math_gelu',
  description: 'GELU activation (Gaussian Error Linear Unit). Used in transformers.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_gelu', inputData),
});

export const math_swish = createTool({
  id: 'math_swish',
  description: 'Swish activation: x×sigmoid(x). Self-gated activation.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_swish', inputData),
});

// ============================================================================
// Neural Network Building Blocks
// ============================================================================

export const math_linear = createTool({
  id: 'math_linear',
  description: 'Linear/Dense layer: y = Wx + b. Core building block of neural networks.',
  inputSchema: z.object({
    x: z.array(z.number()).describe('Input vector'),
    weights: z.array(z.array(z.number())).describe('Weight matrix (output_dim × input_dim)'),
    bias: z.array(z.number()).optional().describe('Bias vector (output_dim)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_linear', inputData),
});

export const math_forward_pass = createTool({
  id: 'math_forward_pass',
  description: 'Run a forward pass through multiple layers. Each layer has weights, optional bias, and activation.',
  inputSchema: z.object({
    x: z.array(z.number()).describe('Input vector'),
    layers: z.array(z.object({
      weights: z.array(z.array(z.number())).describe('Weight matrix'),
      bias: z.array(z.number()).optional().describe('Bias vector'),
      activation: z.enum(['none', 'relu', 'sigmoid', 'tanh', 'softmax', 'gelu', 'leaky_relu']).default('none'),
      alpha: z.number().optional().describe('Alpha for leaky_relu'),
    })).describe('List of layer configurations'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_forward_pass', inputData),
});

export const math_cross_entropy_loss = createTool({
  id: 'math_cross_entropy_loss',
  description: 'Cross-entropy loss for classification tasks.',
  inputSchema: z.object({
    predictions: z.array(z.number()).describe('Predicted probabilities (after softmax)'),
    targets: z.union([
      z.number().int(),
      z.array(z.number()),
    ]).describe('Target class index or one-hot vector'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_cross_entropy_loss', inputData),
});

export const math_mse_loss = createTool({
  id: 'math_mse_loss',
  description: 'Mean squared error loss for regression tasks.',
  inputSchema: z.object({
    predictions: TensorSchema.describe('Predicted values'),
    targets: TensorSchema.describe('Target values'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_mse_loss', inputData),
});

// ============================================================================
// Comparison & Logic
// ============================================================================

export const math_compare = createTool({
  id: 'math_compare',
  description: 'Compare two values elementwise. Returns 1.0 for true, 0.0 for false.',
  inputSchema: z.object({
    a: TensorSchema.describe('First operand'),
    b: TensorSchema.describe('Second operand'),
    op: z.enum(['eq', 'ne', 'lt', 'le', 'gt', 'ge']).describe('Comparison operator'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_compare', inputData),
});

export const math_clip = createTool({
  id: 'math_clip',
  description: 'Clip values to [min, max] range.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input value(s)'),
    min: z.number().optional().describe('Minimum value'),
    max: z.number().optional().describe('Maximum value'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_clip', inputData),
});

export const math_where = createTool({
  id: 'math_where',
  description: 'Conditional selection: returns x where condition is true, else y.',
  inputSchema: z.object({
    condition: z.union([
      z.boolean(),
      z.array(z.boolean()),
      z.array(z.array(z.boolean())),
    ]).describe('Condition(s)'),
    x: TensorSchema.describe('Value(s) when true'),
    y: TensorSchema.describe('Value(s) when false'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_where', inputData),
});

// ============================================================================
// Array Operations
// ============================================================================

export const math_concat = createTool({
  id: 'math_concat',
  description: 'Concatenate arrays along an axis.',
  inputSchema: z.object({
    arrays: z.array(TensorSchema).describe('Arrays to concatenate'),
    axis: z.number().int().default(0).describe('Axis to concatenate along'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_concat', inputData),
});

export const math_stack = createTool({
  id: 'math_stack',
  description: 'Stack arrays along a new axis.',
  inputSchema: z.object({
    arrays: z.array(TensorSchema).describe('Arrays to stack'),
    axis: z.number().int().default(0).describe('Axis to stack along'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_stack', inputData),
});

export const math_slice = createTool({
  id: 'math_slice',
  description: 'Slice a tensor.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    start: z.number().int().default(0).describe('Start index'),
    stop: z.number().int().optional().describe('Stop index (exclusive)'),
    step: z.number().int().default(1).describe('Step size'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_slice', inputData),
});

export const math_get_index = createTool({
  id: 'math_get_index',
  description: 'Get element at a specific index.',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    index: z.number().int().describe('Index (supports negative)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_get_index', inputData),
});

export const math_set_index = createTool({
  id: 'math_set_index',
  description: 'Set element at index (returns new array).',
  inputSchema: z.object({
    x: TensorSchema.describe('Input tensor'),
    index: z.number().int().describe('Index to set'),
    value: TensorSchema.describe('New value (scalar or sub-tensor)'),
  }),
  outputSchema: ResultSchema,
  execute: async (inputData, context) => execLocalTool('math_set_index', inputData),
});
