import matplotlib.pyplot as plt
import numpy as np

fig = plt.figure(figsize=(8, 6))
ax = fig.add_subplot(111, projection='3d')

# Origin
O = np.array([0, 0, 0])

# Radius vector (r) - e.g., along X axis
r = np.array([1, 0, 0])

# Force vector (F) - e.g., along Y axis
F = np.array([0, 1, 0])

# Torque vector (tau) = r x F - will be along Z axis
tau = np.cross(r, F)

# Plot vectors
ax.quiver(*O, *r, color='blue', linewidth=3, label='Radius (r) - Index Finger', arrow_length_ratio=0.1)
ax.quiver(*O, *F, color='green', linewidth=3, label='Force (F) - Middle Finger', arrow_length_ratio=0.1)
ax.quiver(*O, *tau, color='red', linewidth=4, label='Axis of Rotation (tau) - Thumb', arrow_length_ratio=0.1)

# Draw a circle to represent the rotation plane
theta = np.linspace(0, 2*np.pi, 100)
x_circle = np.cos(theta)
y_circle = np.sin(theta)
z_circle = np.zeros_like(theta)
ax.plot(x_circle, y_circle, z_circle, color='gray', linestyle='--', alpha=0.5, label='Plane of Rotation')

# Set limits and labels
ax.set_xlim([-1.5, 1.5])
ax.set_ylim([-1.5, 1.5])
ax.set_zlim([-0.5, 1.5])

ax.set_xlabel('X Axis')
ax.set_ylabel('Y Axis')
ax.set_zlabel('Z Axis')
ax.set_title('Right-Hand Rule: Axis of Rotation')
ax.legend()

plt.show()