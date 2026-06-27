import os
from faster_whisper import WhisperModel

print("Starting Whisper 'base' model download...")
model_size = "base"
# Downloading the model to a local directory named 'whisper_models'
model = WhisperModel(model_size, device="cpu", compute_type="int8", download_root="./whisper_models")
print("Download complete. Model is ready to use!")
