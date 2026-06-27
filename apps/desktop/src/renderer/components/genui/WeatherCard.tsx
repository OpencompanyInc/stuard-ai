import React from 'react';
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Wind, Droplets, Thermometer } from 'lucide-react';

interface WeatherCardProps {
  location: string;
  temperature: number;
  condition: string;
  humidity?: number;
  windSpeed?: number;
  unit?: 'C' | 'F';
  forecast?: Array<{
    day: string;
    temp: number;
    condition: string;
  }>;
}

export const WeatherCard: React.FC<WeatherCardProps> = ({
  location,
  temperature,
  condition,
  humidity,
  windSpeed,
  unit = 'C',
  forecast
}) => {
  const getIcon = (cond: string) => {
    const c = cond.toLowerCase();
    if (c.includes('rain')) return <CloudRain className="w-8 h-8 text-blue-400" />;
    if (c.includes('snow')) return <CloudSnow className="w-8 h-8 text-white" />;
    if (c.includes('storm') || c.includes('thunder')) return <CloudLightning className="w-8 h-8 text-yellow-400" />;
    if (c.includes('cloud')) return <Cloud className="w-8 h-8 text-gray-400" />;
    if (c.includes('wind')) return <Wind className="w-8 h-8 text-gray-300" />;
    return <Sun className="w-8 h-8 text-yellow-500" />;
  };

  const getSmallIcon = (cond: string) => {
    const c = cond.toLowerCase();
    if (c.includes('rain')) return <CloudRain className="w-4 h-4 text-blue-400" />;
    if (c.includes('snow')) return <CloudSnow className="w-4 h-4 text-white" />;
    if (c.includes('storm')) return <CloudLightning className="w-4 h-4 text-yellow-400" />;
    if (c.includes('cloud')) return <Cloud className="w-4 h-4 text-gray-400" />;
    return <Sun className="w-4 h-4 text-yellow-500" />;
  };

  return (
    <div className="w-full max-w-sm bg-theme-card border border-theme/10 rounded-xl overflow-hidden shadow-lg p-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold text-theme-text">{location}</h2>
          <p className="text-sm text-theme-muted capitalize">{condition}</p>
        </div>
        {getIcon(condition)}
      </div>

      <div className="flex items-center mb-6">
        <span className="text-4xl font-bold text-theme-text">
          {temperature}°{unit}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {humidity !== undefined && (
          <div className="flex items-center space-x-2 bg-theme-bg/50 p-2 rounded-lg">
            <Droplets className="w-4 h-4 text-blue-400" />
            <div className="flex flex-col">
              <span className="text-xs text-theme-muted">Humidity</span>
              <span className="text-sm font-medium text-theme-text">{humidity}%</span>
            </div>
          </div>
        )}
        {windSpeed !== undefined && (
          <div className="flex items-center space-x-2 bg-theme-bg/50 p-2 rounded-lg">
            <Wind className="w-4 h-4 text-gray-400" />
            <div className="flex flex-col">
              <span className="text-xs text-theme-muted">Wind</span>
              <span className="text-sm font-medium text-theme-text">{windSpeed} km/h</span>
            </div>
          </div>
        )}
      </div>

      {forecast && forecast.length > 0 && (
        <div className="border-t border-theme/10 pt-4">
          <div className="grid grid-cols-5 gap-2">
            {forecast.map((day, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <span className="text-xs text-theme-muted mb-1">{day.day}</span>
                {getSmallIcon(day.condition)}
                <span className="text-xs font-bold text-theme-text mt-1">{day.temp}°</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
