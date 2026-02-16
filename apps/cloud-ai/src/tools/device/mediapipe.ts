import { z } from 'zod';
import { makeLocalTool } from './shared';

const confidenceSchema = z.number().min(0).max(1).optional().default(0.5);
const outputFormatSchema = z.enum(['base64', 'file']).optional().default('base64').describe('Output format: base64 returns a data URL, file saves to disk');

export const mediapipe_status = makeLocalTool(
  'mediapipe_status',
  'Check if MediaPipe is installed and available locally.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    available: z.boolean().optional(),
    version: z.string().nullable().optional(),
  }),
);

export const mediapipe_setup = makeLocalTool(
  'mediapipe_setup',
  'Install MediaPipe + opencv-python + numpy into a managed Python environment. This may take a few minutes on first run.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    available: z.boolean().optional(),
    version: z.string().nullable().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  600000, // 10 min timeout for installation
);

export const mediapipe_pose = makeLocalTool(
  'mediapipe_pose',
  'Detect body pose landmarks (33 points) in an image using MediaPipe. Returns normalized + pixel coordinates for each landmark. Optionally draws skeleton on output image.',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL (data:image/...;base64,...) as input instead of file path'),
    outputPath: z.string().optional().describe('Path for annotated output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    drawLandmarks: z.boolean().optional().default(true).describe('Draw skeleton on output image'),
    modelComplexity: z.number().int().min(0).max(2).optional().default(1).describe('0=lite, 1=full, 2=heavy'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
    minTrackingConfidence: confidenceSchema.describe('Min tracking confidence'),
  }),
  z.object({
    ok: z.boolean(),
    poseDetected: z.boolean().optional(),
    landmarks: z.array(z.any()).optional(),
    landmarkCount: z.number().optional(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_hands = makeLocalTool(
  'mediapipe_hands',
  'Detect hand landmarks (21 points per hand) in an image using MediaPipe. Returns landmarks for each detected hand with handedness (Left/Right).',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL as input instead of file path'),
    outputPath: z.string().optional().describe('Path for annotated output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    drawLandmarks: z.boolean().optional().default(true).describe('Draw hand skeleton on output'),
    maxNumHands: z.number().int().min(1).max(4).optional().default(2).describe('Max hands to detect'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
    minTrackingConfidence: confidenceSchema.describe('Min tracking confidence'),
  }),
  z.object({
    ok: z.boolean(),
    hands: z.array(z.any()).optional(),
    handCount: z.number().optional(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_face_detection = makeLocalTool(
  'mediapipe_face_detection',
  'Detect faces in an image with bounding boxes, keypoints (eyes, nose, mouth, ears), and confidence scores.',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL as input instead of file path'),
    outputPath: z.string().optional().describe('Path for annotated output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    drawDetections: z.boolean().optional().default(true).describe('Draw face boxes on output'),
    modelSelection: z.number().int().min(0).max(1).optional().default(0).describe('0=short-range (2m), 1=full-range (5m)'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
  }),
  z.object({
    ok: z.boolean(),
    faces: z.array(z.any()).optional(),
    faceCount: z.number().optional(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_face_mesh = makeLocalTool(
  'mediapipe_face_mesh',
  'Detect 468 face mesh landmarks in an image using MediaPipe. Provides detailed facial geometry for expression analysis, AR overlays, etc.',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL as input instead of file path'),
    outputPath: z.string().optional().describe('Path for annotated output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    drawLandmarks: z.boolean().optional().default(true).describe('Draw face mesh on output'),
    maxNumFaces: z.number().int().min(1).max(4).optional().default(1).describe('Max faces to detect'),
    refineLandmarks: z.boolean().optional().default(true).describe('Refine eye and lip landmarks'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
    minTrackingConfidence: confidenceSchema.describe('Min tracking confidence'),
  }),
  z.object({
    ok: z.boolean(),
    faces: z.array(z.any()).optional(),
    faceCount: z.number().optional(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_segmentation = makeLocalTool(
  'mediapipe_segmentation',
  'Segment a person from the background using MediaPipe Selfie Segmentation. Can replace background with color, blur it, or output transparent PNG.',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL as input instead of file path'),
    outputPath: z.string().optional().describe('Path for output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    modelSelection: z.number().int().min(0).max(1).optional().default(0).describe('0=general, 1=landscape'),
    threshold: z.number().min(0).max(1).optional().default(0.5).describe('Segmentation threshold'),
    backgroundColor: z.string().optional().describe('Hex color for background replacement (e.g. #00FF00). Omit for transparent PNG.'),
    blurBackground: z.boolean().optional().default(false).describe('Blur background instead of replacing'),
    blurStrength: z.number().int().min(1).optional().default(21).describe('Blur kernel size (odd number)'),
  }),
  z.object({
    ok: z.boolean(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    maskPath: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_holistic = makeLocalTool(
  'mediapipe_holistic',
  'Run holistic detection (pose + both hands + face mesh) on an image in a single pass. Returns all landmark sets together.',
  z.object({
    imagePath: z.string().optional().describe('Path to input image file'),
    imageData: z.string().optional().describe('Base64 data URL as input instead of file path'),
    outputPath: z.string().optional().describe('Path for annotated output image (used when outputFormat=file)'),
    outputFormat: outputFormatSchema,
    drawLandmarks: z.boolean().optional().default(true).describe('Draw all landmarks on output'),
    modelComplexity: z.number().int().min(0).max(2).optional().default(1).describe('0=lite, 1=full, 2=heavy'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
    minTrackingConfidence: confidenceSchema.describe('Min tracking confidence'),
  }),
  z.object({
    ok: z.boolean(),
    pose: z.any().optional(),
    leftHand: z.any().optional(),
    rightHand: z.any().optional(),
    face: z.any().optional(),
    outputPath: z.string().nullable().optional(),
    outputDataUrl: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  300000,
);

export const mediapipe_process_video = makeLocalTool(
  'mediapipe_process_video',
  'Process a video file frame-by-frame with MediaPipe. Extracts landmarks per frame and optionally writes an annotated output video.',
  z.object({
    videoPath: z.string().describe('Path to input video file'),
    outputPath: z.string().optional().describe('Path for annotated output video (.mp4)'),
    task: z.enum(['pose', 'hands', 'face_detection', 'face_mesh', 'holistic']).optional().default('pose').describe('Which MediaPipe task to run'),
    drawLandmarks: z.boolean().optional().default(true).describe('Draw landmarks on output video'),
    maxFrames: z.number().int().min(0).optional().default(0).describe('Max frames to process (0=all)'),
    sampleEveryN: z.number().int().min(1).optional().default(1).describe('Process every Nth frame (1=every frame)'),
    minDetectionConfidence: confidenceSchema.describe('Min detection confidence'),
  }),
  z.object({
    ok: z.boolean(),
    frameCount: z.number().optional(),
    processedFrames: z.number().optional(),
    framesWithDetection: z.number().optional(),
    outputPath: z.string().nullable().optional(),
    frameLandmarks: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  1800000, // 30 min timeout for video
);
