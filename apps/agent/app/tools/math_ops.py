"""
Math & Neural Network Operations
Provides arithmetic, matrix, and activation function tools for building
mini neural networks and mathematical computations within workflows.
"""
from __future__ import annotations
import math
from typing import Any, Dict, List, Union

Number = Union[int, float]
Tensor = Union[Number, List[Any]]


def _to_num(val: Any) -> Number:
    """Convert value to number, handling strings."""
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        try:
            return float(val) if '.' in val else int(val)
        except ValueError:
            return 0
    if isinstance(val, list):
        return _to_num_recursive(val)
    return 0


def _to_num_recursive(val: Any) -> Any:
    """Recursively convert all values in a structure to numbers."""
    if isinstance(val, list):
        return [_to_num_recursive(v) for v in val]
    return _to_num(val)


def _to_list(val: Any) -> List:
    """Convert value to list if not already."""
    if isinstance(val, list):
        return val
    return [val]


def _shape(t: Tensor) -> List[int]:
    """Get shape of a tensor (nested list)."""
    if not isinstance(t, list):
        return []
    if len(t) == 0:
        return [0]
    inner = _shape(t[0])
    return [len(t)] + inner


def _flatten(t: Tensor) -> List[Number]:
    """Flatten a nested list to 1D."""
    if not isinstance(t, list):
        return [t]
    result = []
    for item in t:
        result.extend(_flatten(item))
    return result


def _reshape(flat: List[Number], shape: List[int]) -> Tensor:
    """Reshape a flat list into nested structure."""
    if len(shape) == 0:
        return flat[0] if flat else 0
    if len(shape) == 1:
        return flat[:shape[0]]
    
    size = 1
    for dim in shape[1:]:
        size *= dim
    
    result = []
    for i in range(shape[0]):
        chunk = flat[i * size:(i + 1) * size]
        result.append(_reshape(chunk, shape[1:]))
    return result


def _elementwise(a: Tensor, b: Tensor, op: str) -> Tensor:
    """Apply elementwise operation."""
    if not isinstance(a, list) and not isinstance(b, list):
        if op == 'add':
            return a + b
        elif op == 'sub':
            return a - b
        elif op == 'mul':
            return a * b
        elif op == 'div':
            return a / b if b != 0 else float('inf')
        elif op == 'pow':
            return a ** b
        elif op == 'max':
            return max(a, b)
        elif op == 'min':
            return min(a, b)
    
    if not isinstance(a, list):
        a = [a] * len(b)
    if not isinstance(b, list):
        b = [b] * len(a)
    
    return [_elementwise(ai, bi, op) for ai, bi in zip(a, b)]


def _apply_func(t: Tensor, func) -> Tensor:
    """Apply a function elementwise."""
    if not isinstance(t, list):
        return func(t)
    return [_apply_func(item, func) for item in t]


# ============================================================================
# Basic Arithmetic
# ============================================================================

async def math_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add two values/tensors elementwise."""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 0))
    result = _elementwise(a, b, 'add')
    return {'ok': True, 'result': result}


async def math_subtract(args: Dict[str, Any]) -> Dict[str, Any]:
    """Subtract b from a elementwise."""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 0))
    result = _elementwise(a, b, 'sub')
    return {'ok': True, 'result': result}


async def math_multiply(args: Dict[str, Any]) -> Dict[str, Any]:
    """Multiply two values/tensors elementwise."""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 0))
    result = _elementwise(a, b, 'mul')
    return {'ok': True, 'result': result}


async def math_divide(args: Dict[str, Any]) -> Dict[str, Any]:
    """Divide a by b elementwise."""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 1))
    result = _elementwise(a, b, 'div')
    return {'ok': True, 'result': result}


async def math_power(args: Dict[str, Any]) -> Dict[str, Any]:
    """Raise a to power b elementwise."""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 1))
    result = _elementwise(a, b, 'pow')
    return {'ok': True, 'result': result}


async def math_sqrt(args: Dict[str, Any]) -> Dict[str, Any]:
    """Square root elementwise."""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, lambda v: math.sqrt(max(0, v)))
    return {'ok': True, 'result': result}


async def math_abs(args: Dict[str, Any]) -> Dict[str, Any]:
    """Absolute value elementwise."""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, abs)
    return {'ok': True, 'result': result}


async def math_negate(args: Dict[str, Any]) -> Dict[str, Any]:
    """Negate values elementwise."""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, lambda v: -v)
    return {'ok': True, 'result': result}


async def math_exp(args: Dict[str, Any]) -> Dict[str, Any]:
    """Exponential (e^x) elementwise."""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, lambda v: math.exp(min(v, 700)))  # Prevent overflow
    return {'ok': True, 'result': result}


async def math_log(args: Dict[str, Any]) -> Dict[str, Any]:
    """Natural logarithm elementwise."""
    x = _to_num_recursive(args.get('x', 1))
    result = _apply_func(x, lambda v: math.log(max(v, 1e-10)))
    return {'ok': True, 'result': result}


# ============================================================================
# Aggregation Operations
# ============================================================================

async def math_sum(args: Dict[str, Any]) -> Dict[str, Any]:
    """Sum all elements or along an axis."""
    x = _to_num_recursive(args.get('x', []))
    axis = args.get('axis')
    
    if axis is None:
        flat = _flatten(x)
        result = sum(flat)
    else:
        if not isinstance(x, list):
            result = x
        elif axis == 0:
            if not x:
                result = []
            elif not isinstance(x[0], list):
                result = sum(x)
            else:
                result = x[0][:]
                for row in x[1:]:
                    result = _elementwise(result, row, 'add')
        else:
            result = [await math_sum({'x': row, 'axis': axis - 1}) for row in x]
            result = [r['result'] for r in result]
    
    return {'ok': True, 'result': result}


async def math_mean(args: Dict[str, Any]) -> Dict[str, Any]:
    """Mean of all elements or along an axis."""
    x = _to_num_recursive(args.get('x', []))
    axis = args.get('axis')
    
    flat = _flatten(x)
    if axis is None:
        result = sum(flat) / len(flat) if flat else 0
    else:
        sum_result = await math_sum({'x': x, 'axis': axis})
        s = sum_result['result']
        if isinstance(x, list) and x:
            n = len(x) if axis == 0 else len(x[0]) if isinstance(x[0], list) else 1
            result = _apply_func(s, lambda v: v / n) if n > 0 else s
        else:
            result = s
    
    return {'ok': True, 'result': result}


async def math_max(args: Dict[str, Any]) -> Dict[str, Any]:
    """Maximum value."""
    x = _to_num_recursive(args.get('x', []))
    flat = _flatten(x)
    result = max(flat) if flat else 0
    return {'ok': True, 'result': result}


async def math_min(args: Dict[str, Any]) -> Dict[str, Any]:
    """Minimum value."""
    x = _to_num_recursive(args.get('x', []))
    flat = _flatten(x)
    result = min(flat) if flat else 0
    return {'ok': True, 'result': result}


async def math_argmax(args: Dict[str, Any]) -> Dict[str, Any]:
    """Index of maximum value."""
    x = _to_num_recursive(args.get('x', []))
    flat = _flatten(x)
    if not flat:
        return {'ok': True, 'result': -1}
    result = flat.index(max(flat))
    return {'ok': True, 'result': result}


async def math_argmin(args: Dict[str, Any]) -> Dict[str, Any]:
    """Index of minimum value."""
    x = _to_num_recursive(args.get('x', []))
    flat = _flatten(x)
    if not flat:
        return {'ok': True, 'result': -1}
    result = flat.index(min(flat))
    return {'ok': True, 'result': result}


# ============================================================================
# Matrix Operations
# ============================================================================

async def math_dot(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Dot product / matrix multiplication.
    - 1D x 1D: inner product (scalar)
    - 2D x 1D: matrix-vector product
    - 2D x 2D: matrix multiplication
    """
    a = _to_num_recursive(args.get('a', []))
    b = _to_num_recursive(args.get('b', []))
    
    shape_a = _shape(a)
    shape_b = _shape(b)
    
    # 1D x 1D: dot product
    if len(shape_a) == 1 and len(shape_b) == 1:
        if len(a) != len(b):
            return {'ok': False, 'error': f'Shape mismatch: {shape_a} vs {shape_b}'}
        result = sum(ai * bi for ai, bi in zip(a, b))
        return {'ok': True, 'result': result}
    
    # 2D x 1D: matrix-vector
    if len(shape_a) == 2 and len(shape_b) == 1:
        if shape_a[1] != shape_b[0]:
            return {'ok': False, 'error': f'Shape mismatch: {shape_a} vs {shape_b}'}
        result = [sum(ai * bi for ai, bi in zip(row, b)) for row in a]
        return {'ok': True, 'result': result}
    
    # 2D x 2D: matrix multiplication
    if len(shape_a) == 2 and len(shape_b) == 2:
        if shape_a[1] != shape_b[0]:
            return {'ok': False, 'error': f'Shape mismatch: {shape_a[1]} != {shape_b[0]}'}
        
        # Transpose b for easier column access
        b_t = [[b[j][i] for j in range(len(b))] for i in range(len(b[0]))]
        result = [[sum(ai * bi for ai, bi in zip(row_a, col_b)) for col_b in b_t] for row_a in a]
        return {'ok': True, 'result': result}
    
    return {'ok': False, 'error': f'Unsupported shapes: {shape_a} x {shape_b}'}


async def math_transpose(args: Dict[str, Any]) -> Dict[str, Any]:
    """Transpose a 2D matrix."""
    x = _to_num_recursive(args.get('x', []))
    if not x or not isinstance(x[0], list):
        return {'ok': True, 'result': x}
    
    rows = len(x)
    cols = len(x[0])
    result = [[x[j][i] for j in range(rows)] for i in range(cols)]
    return {'ok': True, 'result': result}


async def math_reshape(args: Dict[str, Any]) -> Dict[str, Any]:
    """Reshape tensor to new shape."""
    x = _to_num_recursive(args.get('x', []))
    shape = [int(_to_num(s)) for s in (args.get('shape', []) or [])]
    
    flat = _flatten(x)
    target_size = 1
    for dim in shape:
        target_size *= dim
    
    if len(flat) != target_size:
        return {'ok': False, 'error': f'Cannot reshape {len(flat)} elements to shape {shape}'}
    
    result = _reshape(flat, shape)
    return {'ok': True, 'result': result}


async def math_shape(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get shape of a tensor."""
    x = _to_num_recursive(args.get('x', []))
    result = _shape(x)
    return {'ok': True, 'result': result}


async def math_flatten(args: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten tensor to 1D."""
    x = _to_num_recursive(args.get('x', []))
    result = _flatten(x)
    return {'ok': True, 'result': result}


# ============================================================================
# Tensor Creation
# ============================================================================

async def math_zeros(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create tensor of zeros."""
    shape = [int(_to_num(s)) for s in (args.get('shape', [1]) or [1])]
    
    def make_zeros(s: List[int]) -> Tensor:
        if len(s) == 0:
            return 0.0
        if len(s) == 1:
            return [0.0] * s[0]
        return [make_zeros(s[1:]) for _ in range(s[0])]
    
    result = make_zeros(shape)
    return {'ok': True, 'result': result}


async def math_ones(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create tensor of ones."""
    shape = [int(_to_num(s)) for s in (args.get('shape', [1]) or [1])]
    
    def make_ones(s: List[int]) -> Tensor:
        if len(s) == 0:
            return 1.0
        if len(s) == 1:
            return [1.0] * s[0]
        return [make_ones(s[1:]) for _ in range(s[0])]
    
    result = make_ones(shape)
    return {'ok': True, 'result': result}


async def math_random(args: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a random number between min and max (inclusive)."""
    import random
    min_val = _to_num(args.get('min', 1))
    max_val = _to_num(args.get('max', 10))
    is_integer = args.get('integer', True)
    seed = args.get('seed')
    
    if seed is not None:
        random.seed(seed)
    
    if is_integer:
        result = random.randint(int(min_val), int(max_val))
    else:
        result = random.uniform(float(min_val), float(max_val))
    return {'ok': True, 'result': result}


async def math_range(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a range of values."""
    start = _to_num(args.get('start', 0))
    stop = _to_num(args.get('stop', 10))
    step = _to_num(args.get('step', 1))
    
    result = []
    current = start
    while (step > 0 and current < stop) or (step < 0 and current > stop):
        result.append(current)
        current += step
    
    return {'ok': True, 'result': result}


async def math_linspace(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create linearly spaced values."""
    start = _to_num(args.get('start', 0))
    stop = _to_num(args.get('stop', 1))
    num = int(_to_num(args.get('num', 10)))
    
    if num <= 1:
        result = [start]
    else:
        step = (stop - start) / (num - 1)
        result = [start + i * step for i in range(num)]
    
    return {'ok': True, 'result': result}


# ============================================================================
# Activation Functions (for neural networks)
# ============================================================================

async def math_sigmoid(args: Dict[str, Any]) -> Dict[str, Any]:
    """Sigmoid activation: 1 / (1 + e^-x)"""
    x = _to_num_recursive(args.get('x', 0))
    
    def sigmoid(v):
        if v >= 0:
            return 1 / (1 + math.exp(-v))
        else:
            exp_v = math.exp(v)
            return exp_v / (1 + exp_v)
    
    result = _apply_func(x, sigmoid)
    return {'ok': True, 'result': result}


async def math_relu(args: Dict[str, Any]) -> Dict[str, Any]:
    """ReLU activation: max(0, x)"""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, lambda v: max(0, v))
    return {'ok': True, 'result': result}


async def math_leaky_relu(args: Dict[str, Any]) -> Dict[str, Any]:
    """Leaky ReLU: x if x > 0 else alpha * x"""
    x = _to_num_recursive(args.get('x', 0))
    alpha = _to_num(args.get('alpha', 0.01))
    result = _apply_func(x, lambda v: v if v > 0 else alpha * v)
    return {'ok': True, 'result': result}


async def math_tanh(args: Dict[str, Any]) -> Dict[str, Any]:
    """Tanh activation."""
    x = _to_num_recursive(args.get('x', 0))
    result = _apply_func(x, math.tanh)
    return {'ok': True, 'result': result}


async def math_softmax(args: Dict[str, Any]) -> Dict[str, Any]:
    """Softmax activation for a 1D vector."""
    x = _to_num_recursive(args.get('x', []))
    
    if not isinstance(x, list):
        return {'ok': True, 'result': 1.0}
    
    # Numerical stability: subtract max
    max_val = max(x)
    exp_x = [math.exp(v - max_val) for v in x]
    sum_exp = sum(exp_x)
    result = [e / sum_exp for e in exp_x]
    
    return {'ok': True, 'result': result}


async def math_gelu(args: Dict[str, Any]) -> Dict[str, Any]:
    """GELU activation (Gaussian Error Linear Unit)."""
    x = _to_num_recursive(args.get('x', 0))
    
    def gelu(v):
        return 0.5 * v * (1 + math.tanh(math.sqrt(2 / math.pi) * (v + 0.044715 * v ** 3)))
    
    result = _apply_func(x, gelu)
    return {'ok': True, 'result': result}


async def math_swish(args: Dict[str, Any]) -> Dict[str, Any]:
    """Swish activation: x * sigmoid(x)"""
    x = _to_num_recursive(args.get('x', 0))
    
    def swish(v):
        sig = 1 / (1 + math.exp(-min(max(v, -500), 500)))
        return v * sig
    
    result = _apply_func(x, swish)
    return {'ok': True, 'result': result}


# ============================================================================
# Neural Network Building Blocks
# ============================================================================

async def math_linear(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Linear layer: output = input @ weights + bias
    Performs: y = Wx + b
    """
    x = _to_num_recursive(args.get('x', []))  # Input vector or batch
    weights = _to_num_recursive(args.get('weights', []))  # Weight matrix
    bias = _to_num_recursive(args.get('bias')) if args.get('bias') is not None else None  # Optional bias vector
    
    # Matrix-vector multiplication
    dot_result = await math_dot({'a': weights, 'b': x})
    if not dot_result['ok']:
        return dot_result
    
    result = dot_result['result']
    
    # Add bias if provided
    if bias is not None:
        result = _elementwise(result, bias, 'add')
    
    return {'ok': True, 'result': result}


async def math_forward_pass(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run a forward pass through a list of layers.
    Each layer is: {weights, bias?, activation?}
    """
    x = _to_num_recursive(args.get('x', []))
    layers = args.get('layers', [])
    
    current = x
    for i, layer in enumerate(layers):
        weights = layer.get('weights', [])
        bias = layer.get('bias')
        activation = layer.get('activation', 'none')
        
        # Linear transformation
        linear_result = await math_linear({'x': current, 'weights': weights, 'bias': bias})
        if not linear_result['ok']:
            return {'ok': False, 'error': f'Layer {i} failed: {linear_result.get("error")}'}
        
        current = linear_result['result']
        
        # Apply activation
        if activation == 'relu':
            act_result = await math_relu({'x': current})
        elif activation == 'sigmoid':
            act_result = await math_sigmoid({'x': current})
        elif activation == 'tanh':
            act_result = await math_tanh({'x': current})
        elif activation == 'softmax':
            act_result = await math_softmax({'x': current})
        elif activation == 'gelu':
            act_result = await math_gelu({'x': current})
        elif activation == 'leaky_relu':
            alpha = layer.get('alpha', 0.01)
            act_result = await math_leaky_relu({'x': current, 'alpha': alpha})
        else:
            act_result = {'ok': True, 'result': current}
        
        current = act_result['result']
    
    return {'ok': True, 'result': current}


async def math_cross_entropy_loss(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cross-entropy loss for classification."""
    predictions = _to_num_recursive(args.get('predictions', []))  # After softmax
    targets = _to_num_recursive(args.get('targets', []))  # One-hot or indices
    
    if not predictions:
        return {'ok': False, 'error': 'No predictions provided'}
    
    # If targets are indices, convert to one-hot
    if isinstance(targets, int) or (isinstance(targets, list) and targets and not isinstance(targets[0], list) and all(isinstance(t, int) for t in targets)):
        if isinstance(targets, int):
            targets = [targets]
        # Convert to one-hot
        num_classes = len(predictions[0]) if isinstance(predictions[0], list) else len(predictions)
        one_hot = []
        for t in targets:
            oh = [0.0] * num_classes
            oh[t] = 1.0
            one_hot.append(oh)
        targets = one_hot if len(one_hot) > 1 else one_hot[0]
    
    # Compute cross-entropy
    eps = 1e-10
    if isinstance(predictions[0], list):
        # Batch mode
        losses = []
        for pred, target in zip(predictions, targets):
            loss = -sum(t * math.log(max(p, eps)) for p, t in zip(pred, target))
            losses.append(loss)
        result = sum(losses) / len(losses)
    else:
        # Single sample
        result = -sum(t * math.log(max(p, eps)) for p, t in zip(predictions, targets))
    
    return {'ok': True, 'result': result}


async def math_mse_loss(args: Dict[str, Any]) -> Dict[str, Any]:
    """Mean squared error loss."""
    predictions = _to_num_recursive(args.get('predictions', []))
    targets = _to_num_recursive(args.get('targets', []))
    
    pred_flat = _flatten(predictions)
    target_flat = _flatten(targets)
    
    if len(pred_flat) != len(target_flat):
        return {'ok': False, 'error': 'Shape mismatch between predictions and targets'}
    
    mse = sum((p - t) ** 2 for p, t in zip(pred_flat, target_flat)) / len(pred_flat)
    return {'ok': True, 'result': mse}


# ============================================================================
# Comparison & Logic
# ============================================================================

async def math_compare(args: Dict[str, Any]) -> Dict[str, Any]:
    """Compare two values: eq, ne, lt, le, gt, ge"""
    a = _to_num_recursive(args.get('a', 0))
    b = _to_num_recursive(args.get('b', 0))
    op = args.get('op', 'eq')
    
    def compare(va, vb):
        if op == 'eq':
            return 1.0 if va == vb else 0.0
        elif op == 'ne':
            return 1.0 if va != vb else 0.0
        elif op == 'lt':
            return 1.0 if va < vb else 0.0
        elif op == 'le':
            return 1.0 if va <= vb else 0.0
        elif op == 'gt':
            return 1.0 if va > vb else 0.0
        elif op == 'ge':
            return 1.0 if va >= vb else 0.0
        return 0.0
    
    if not isinstance(a, list) and not isinstance(b, list):
        result = compare(a, b)
    else:
        if not isinstance(a, list):
            a = [a] * len(b)
        if not isinstance(b, list):
            b = [b] * len(a)
        result = [compare(ai, bi) for ai, bi in zip(a, b)]
    
    return {'ok': True, 'result': result}


async def math_clip(args: Dict[str, Any]) -> Dict[str, Any]:
    """Clip values to [min, max] range."""
    x = _to_num_recursive(args.get('x', 0))
    min_val = _to_num(args.get('min', float('-inf')))
    max_val = _to_num(args.get('max', float('inf')))
    
    result = _apply_func(x, lambda v: max(min_val, min(max_val, v)))
    return {'ok': True, 'result': result}


async def math_where(args: Dict[str, Any]) -> Dict[str, Any]:
    """Conditional selection: where(condition, x, y)"""
    condition = args.get('condition', [])
    x = _to_num_recursive(args.get('x', 0))
    y = _to_num_recursive(args.get('y', 0))
    
    def select(c, xi, yi):
        return xi if c else yi
    
    if not isinstance(condition, list):
        result = x if condition else y
    else:
        x_list = x if isinstance(x, list) else [x] * len(condition)
        y_list = y if isinstance(y, list) else [y] * len(condition)
        result = [select(c, xi, yi) for c, xi, yi in zip(condition, x_list, y_list)]
    
    return {'ok': True, 'result': result}


# ============================================================================
# Concatenation & Stacking
# ============================================================================

async def math_concat(args: Dict[str, Any]) -> Dict[str, Any]:
    """Concatenate arrays along axis."""
    arrays = _to_num_recursive(args.get('arrays', []))
    axis = int(_to_num(args.get('axis', 0)))
    
    if not arrays:
        return {'ok': True, 'result': []}
    
    if axis == 0:
        result = []
        for arr in arrays:
            if isinstance(arr, list):
                result.extend(arr)
            else:
                result.append(arr)
    else:
        # Concatenate along inner axis
        result = []
        for i in range(len(arrays[0])):
            row = []
            for arr in arrays:
                if isinstance(arr[i], list):
                    row.extend(arr[i])
                else:
                    row.append(arr[i])
            result.append(row)
    
    return {'ok': True, 'result': result}


async def math_stack(args: Dict[str, Any]) -> Dict[str, Any]:
    """Stack arrays along new axis."""
    arrays = _to_num_recursive(args.get('arrays', []))
    axis = int(_to_num(args.get('axis', 0)))
    
    if axis == 0:
        result = arrays
    else:
        # Transpose-like stacking
        result = [[arr[i] for arr in arrays] for i in range(len(arrays[0]))]
    
    return {'ok': True, 'result': result}


async def math_slice(args: Dict[str, Any]) -> Dict[str, Any]:
    """Slice a tensor."""
    x = _to_num_recursive(args.get('x', []))
    start = int(_to_num(args.get('start', 0)))
    stop = int(_to_num(args.get('stop'))) if args.get('stop') is not None else None
    step = int(_to_num(args.get('step', 1)))
    
    if not isinstance(x, list):
        return {'ok': True, 'result': x}
    
    if stop is None:
        stop = len(x)
    
    result = x[start:stop:step]
    return {'ok': True, 'result': result}


async def math_get_index(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get element at index."""
    x = _to_num_recursive(args.get('x', []))
    index = int(_to_num(args.get('index', 0)))
    
    if not isinstance(x, list):
        return {'ok': True, 'result': x}
    
    if index < 0:
        index = len(x) + index
    
    if 0 <= index < len(x):
        return {'ok': True, 'result': x[index]}
    
    return {'ok': False, 'error': f'Index {index} out of bounds for length {len(x)}'}


async def math_set_index(args: Dict[str, Any]) -> Dict[str, Any]:
    """Set element at index (returns new array)."""
    x = _to_num_recursive(args.get('x', []))
    index = int(_to_num(args.get('index', 0)))
    value = _to_num_recursive(args.get('value', 0))
    
    if not isinstance(x, list):
        return {'ok': True, 'result': value}
    
    result = x[:]
    if index < 0:
        index = len(result) + index
    
    if 0 <= index < len(result):
        result[index] = value
        return {'ok': True, 'result': result}
    
    return {'ok': False, 'error': f'Index {index} out of bounds for length {len(x)}'}
