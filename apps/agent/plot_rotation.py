import numpy as np
import matplotlib.pyplot as plt

fig = plt.figure(figsize=(8, 6))
ax = fig.add_subplot(111, projection='3d')

# Define vectors
r = np.array([1.0, 0.0, 0.0])  # Radius vector (e.g., a wrench handle)
F = np.array([0.0, 1.0, 0.0])  # Force vector (pushing the wrench)
tau = np.cross(r, F)           # Torque vector (Axis of rotation)

# Origin
O = np.array([0.0, 0.0, 0.0])

# Plot vectors
ax.quiver(*O, *r, color='blue', linewidth=3, label='Radius ($\\vec{r}$)', arrow_length_ratio=0.1)
ax.quiver(*r, *F, color='green', linewidth=3, label='Force ($\\vec{F}$)', arrow_length_ratio=0.1)
ax.quiver(*O, *tau, color='red', linewidth=4, label='Axis of Rotation / Torque ($\\vec{\\tau}$)', arrow_length_ratio=0.1)

# Draw the arc of rotation
theta = np.linspace(0, np.pi/2, 20)
ax.plot(np.cos(theta), np.sin(theta), np.zeros_like(theta), 'k--', label='Direction of Rotation (Fingers curl)')

# Formatting
ax.set_xlim([-0.5, 1.5])
ax.set_ylim([-0.5, 1.5])
ax.set_zlim([-0.5, 1.5])
ax.set_xlabel('X axis')
ax.set_ylabel('Y axis')
ax.set_zlabel('Z axis')
ax.set_title('Right-Hand Rule: Axis of Rotation')
ax.legend()

print("Plot generated! Close the matplotlib window when you're done viewing it.")
plt.show()