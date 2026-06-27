import 'dotenv/config';
import { analyzeMediaTool } from '../src/tools/analyze-media';

async function testAnalyzeMedia() {
  console.log('Testing analyze_media tool with audio file...');
  console.log('GOOGLE_GENERATIVE_AI_API_KEY:', process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'set' : 'NOT SET');
  console.log('TEMP_MEDIA_BUCKET:', process.env.TEMP_MEDIA_BUCKET || 'NOT SET');

  try {
    const result = await (analyzeMediaTool as any).execute({
      context: {
        task: 'Transcribe this audio and provide a summary of the key points.',
        sources: [
          {
            path: 'C:\\Users\\solar\\OneDrive\\Pictures\\Camera Roll 1\\WIN_20251115_15_10_16_Pro.mp3',
          },
        ],
        mode: 'fast',
      },
      writer: {
        write: async (payload: any) => {
          console.log('[Tool Event]', JSON.stringify(payload, null, 2));
        },
      },
    });

    console.log('\n=== Result ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testAnalyzeMedia();
