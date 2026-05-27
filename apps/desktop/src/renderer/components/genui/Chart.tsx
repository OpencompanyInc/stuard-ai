import React from 'react';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

interface ChartProps {
  type: 'bar' | 'line' | 'pie';
  title?: string;
  data: any[];
  dataKey?: string; // For pie chart value or primary metric
  nameKey?: string; // For pie chart label or x-axis
  series?: { key: string; color?: string; name?: string }[]; // For bar/line multiple series
  height?: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function chartGridStroke(): string {
  if (typeof document === 'undefined') return '#e5e5e5';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#3e3e3e' : '#e5e5e5';
}

export const Chart: React.FC<ChartProps> = ({
  type,
  title,
  data,
  dataKey = 'value',
  nameKey = 'name',
  series = [{ key: 'value', color: '#3b82f6' }],
  height = 300
}) => {
  const gridStroke = chartGridStroke();

  return (
    <div className="w-full my-3 p-4 border border-theme/20 rounded-xl bg-theme-card">
      {title && <h4 className="text-sm font-medium text-theme-fg mb-4">{title}</h4>}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          {type === 'bar' ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey={nameKey} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                cursor={{ fill: '#f5f5f5' }}
              />
              <Legend />
              {series.map((s, i) => (
                <Bar 
                  key={s.key} 
                  dataKey={s.key} 
                  name={s.name || s.key} 
                  fill={s.color || COLORS[i % COLORS.length]} 
                  radius={[4, 4, 0, 0]} 
                />
              ))}
            </BarChart>
          ) : type === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey={nameKey} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <Legend />
              {series.map((s, i) => (
                <Line 
                  key={s.key} 
                  type="monotone" 
                  dataKey={s.key} 
                  name={s.name || s.key} 
                  stroke={s.color || COLORS[i % COLORS.length]} 
                  strokeWidth={2}
                  dot={{ r: 3, fill: s.color || COLORS[i % COLORS.length] }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey={dataKey}
                nameKey={nameKey}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <Legend />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};



