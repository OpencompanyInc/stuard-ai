'use client';

import { useState } from 'react';

interface VoiceWakeUpProps {
  className?: string;
}

export default function VoiceWakeUp({ className = '' }: VoiceWakeUpProps) {
  const [demoState, setDemoState] = useState<'idle' | 'listening' | 'awake' | 'processing'>('idle');
  const [demoTranscript, setDemoTranscript] = useState('');

  const demoSequence = () => {
    if (demoState !== 'idle') return;
    
    // Demo sequence showing how voice wake-up works
    setDemoState('listening');
    setDemoTranscript('');
    
    setTimeout(() => {
      setDemoTranscript('hey stuard');
    }, 1500);
    
    setTimeout(() => {
      setDemoState('awake');
      setDemoTranscript('');
    }, 3000);
    
    setTimeout(() => {
      setDemoTranscript('take a screenshot');
    }, 4000);
    
    setTimeout(() => {
      setDemoState('processing');
    }, 6000);
    
    setTimeout(() => {
      setDemoState('idle');
      setDemoTranscript('');
    }, 8000);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Status Indicator */}
      <div className="flex items-center justify-center space-x-4">
        <button
          onClick={demoSequence}
          disabled={demoState !== 'idle'}
          className={`relative p-4 rounded-full transition-all duration-300 ${
            demoState === 'listening' 
              ? 'bg-blue-500 text-white shadow-lg'
              : demoState === 'awake' || demoState === 'processing'
                ? 'bg-green-500 text-white shadow-lg scale-110' 
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-50'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          
          {/* Pulse animation when listening */}
          {(demoState === 'listening' || demoState === 'awake') && (
            <div className="absolute inset-0 rounded-full bg-current opacity-25 animate-ping"></div>
          )}
        </button>

        <button
          onClick={demoSequence}
          disabled={demoState !== 'idle'}
          className="px-4 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary hover:text-white transition-colors disabled:opacity-50"
        >
          Try Demo
        </button>
      </div>

      {/* Status Text */}
      <div className="text-center">
        <div className="space-y-2">
          <p className={`text-sm font-medium ${
            demoState === 'awake' || demoState === 'processing' ? 'text-green-600' : 
            demoState === 'listening' ? 'text-blue-600' : 'text-gray-500'
          }`}>
            {demoState === 'idle' && '🎤 Click "Try Demo" to see voice wake-up in action'}
            {demoState === 'listening' && '👂 Listening for "Hey Stuard"...'}
            {demoState === 'awake' && '🎯 Listening for commands...'}
            {demoState === 'processing' && '⚡ Processing command...'}
          </p>
          
          {demoTranscript && (
            <div className="bg-gray-50 rounded-lg p-3 max-w-md mx-auto">
              <p className="text-xs text-gray-500 mb-1">
                {demoState === 'awake' || demoState === 'processing' ? 'Command:' : 'Heard:'} 
                <span className="text-green-600"> (Demo)</span>
              </p>
              <p className="text-sm text-gray-800 italic">&ldquo;{demoTranscript}&rdquo;</p>
            </div>
          )}
        </div>
      </div>

      {/* Feature Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">🚀 In the Full App:</h4>
        <ul className="text-xs text-blue-800 space-y-1">
          <li>• Say <strong>&ldquo;Hey Stuard&rdquo;</strong> to wake up your AI assistant</li>
          <li>• Give natural voice commands like &ldquo;take a screenshot&rdquo;</li>
          <li>• Works from anywhere in the room with always-on listening</li>
          <li>• All voice processing happens locally for privacy</li>
          <li>• Automatically sleeps after 30 seconds of inactivity</li>
        </ul>
      </div>

      {/* Download CTA */}
      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg p-4 border border-primary/20 text-center">
        <p className="text-sm text-gray-700 mb-2">
          <strong>Ready to experience real voice control?</strong>
        </p>
        <a 
          href="/download" 
          className="inline-flex items-center space-x-2 text-primary hover:text-primary/80 text-sm font-medium"
        >
          <span>Download Stuard AI</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </div>
    </div>
  );
} 