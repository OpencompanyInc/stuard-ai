declare module 'discord.js' {
  export class Client<T = any> {
    constructor(...args: any[]);
    [key: string]: any;
  }

  export const GatewayIntentBits: any;
  export const Partials: any;
  export const ChannelType: any;
  export const Events: any;
  export const ActivityType: any;
  export const REST: any;
  export const Routes: any;
  export class EmbedBuilder {
    constructor(...args: any[]);
    [key: string]: any;
  }

  export class AttachmentBuilder {
    constructor(...args: any[]);
    [key: string]: any;
  }

  export type Message = any;
  export type Interaction = any;
  export type Attachment = any;
}

declare module '@discordjs/voice' {
  export const joinVoiceChannel: any;
  export const createAudioPlayer: any;
  export const createAudioResource: any;
  export const StreamType: any;
  export const AudioPlayerStatus: any;
  export const EndBehaviorType: any;
  export const VoiceConnectionStatus: any;
  export const entersState: any;

  export type VoiceConnection = any;
  export type AudioPlayer = any;
  export type AudioReceiveStream = any;
}

declare module '@discordjs/opus' {
  export class OpusEncoder {
    constructor(...args: any[]);
    encode(...args: any[]): Buffer;
    decode(...args: any[]): Buffer;
  }

  const opusModule: {
    OpusEncoder: typeof OpusEncoder;
  };

  export default opusModule;
}
