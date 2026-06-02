import { useState } from 'react';

interface BlogFiltersProps {
  categories: string[];
  tags: string[];
  selectedCategory: string;
  selectedTags: string[];
  onCategoryChange: (category: string) => void;
  onTagToggle: (tag: string) => void;
  onClearFilters: () => void;
}

const BlogFilters: React.FC<BlogFiltersProps> = ({
  categories,
  tags,
  selectedCategory,
  selectedTags,
  onCategoryChange,
  onTagToggle,
  onClearFilters
}) => {
  const [showAllTags, setShowAllTags] = useState(false);
  const displayTags = showAllTags ? tags : tags.slice(0, 8);

  const hasActiveFilters = selectedCategory !== 'All' || selectedTags.length > 0;

  return (
    <div className="bg-[#111111] rounded-xl border border-white/10 p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Filter Posts</h3>
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="text-sm text-[#FF6B6E] hover:text-[#FF383C] font-medium transition-colors"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Categories */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-[#D4D4D4] mb-3">Categories</h4>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onCategoryChange('All')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedCategory === 'All'
                ? 'bg-[#FF383C] text-white'
                : 'bg-white/5 text-[#D4D4D4] hover:bg-white/10'
            }`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => onCategoryChange(category)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? 'bg-[#FF383C] text-white'
                  : 'bg-white/5 text-[#D4D4D4] hover:bg-white/10'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <h4 className="text-sm font-medium text-[#D4D4D4] mb-3">Tags</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {displayTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagToggle(tag)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedTags.includes(tag)
                  ? 'bg-[#FF383C] text-white'
                  : 'bg-white/5 text-[#D4D4D4] hover:bg-white/10'
              }`}
            >
              {tag}
              {selectedTags.includes(tag) && (
                <svg className="w-3 h-3 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
        
        {tags.length > 8 && (
          <button
            onClick={() => setShowAllTags(!showAllTags)}
            className="text-sm text-[#FF6B6E] hover:text-[#FF383C] font-medium transition-colors"
          >
            {showAllTags ? 'Show less' : `Show ${tags.length - 8} more tags`}
          </button>
        )}
      </div>

      {/* Active filters summary */}
      {hasActiveFilters && (
        <div className="mt-6 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#A3A3A3]">
              Active filters: {selectedCategory !== 'All' ? 1 : 0} category, {selectedTags.length} tags
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlogFilters; 