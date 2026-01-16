"use client";

import { useState, useMemo } from 'react';
import BlogCard from '@/components/blog/BlogCard';
import BlogFilters from '@/components/blog/BlogFilters';
import {
  blogPosts,
  getFeaturedPosts,
  getAllCategories,
  getAllTags,
  getPostsByCategory
} from '@/lib/blogData';

export default function BlogPage() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'readingTime'>('newest');

  const featuredPosts = getFeaturedPosts();
  const categories = getAllCategories();
  const tags = getAllTags();

  // Filter posts based on selected filters and search
  const filteredPosts = useMemo(() => {
    let posts = blogPosts;

    // Filter by category
    if (selectedCategory !== 'All') {
      posts = getPostsByCategory(selectedCategory);
    }

    // Filter by tags
    if (selectedTags.length > 0) {
      posts = posts.filter(post => 
        selectedTags.some(tag => post.tags.includes(tag))
      );
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      posts = posts.filter(post =>
        post.title.toLowerCase().includes(query) ||
        post.excerpt.toLowerCase().includes(query) ||
        post.author.name.toLowerCase().includes(query) ||
        post.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Sorting
    if (sortBy === 'newest') {
      posts = posts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    } else if (sortBy === 'oldest') {
      posts = posts.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    } else if (sortBy === 'readingTime') {
      posts = posts.sort((a, b) => a.readingTime - b.readingTime);
    }
    return posts;
  }, [selectedCategory, selectedTags, searchQuery, sortBy]);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleClearFilters = () => {
    setSelectedCategory('All');
    setSelectedTags([]);
    setSearchQuery('');
  };

  return (
    <>
      
      <div className="min-h-screen">
        {/* Enhanced Hero Section */}
        <section className="relative overflow-hidden pt-8">
          {/* Animated background elements */}
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 w-full h-full neural-bg opacity-20"></div>
            <div className="absolute top-10 left-10 w-72 h-72 bg-accent/10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-10 right-10 w-96 h-96 bg-secondary/10 rounded-full blur-3xl"></div>
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full h-full">
              <div className="grid grid-cols-8 gap-4 opacity-5">
                {Array.from({ length: 64 }).map((_, i) => (
                  <div key={i} className="h-1 bg-white rounded-full animate-pulse" style={{ animationDelay: `${i * 0.1}s` }}></div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
            <div className="text-center">
              {/* Badge */}
              <div className="inline-flex items-center px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-primary text-sm font-medium mb-6">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Insights & Innovation
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Insights & 
                <span className="block text-primary">
                  Updates
                </span>
              </h1>
              
              <p className="text-xl lg:text-2xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed">
                Explore the latest in AI innovation, privacy technology, and personal productivity. 
                Stay informed with insights from our team and the broader AI community.
              </p>
              
              {/* Enhanced Search Bar */}
              <div className="max-w-2xl mx-auto">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Search articles, authors, or topics..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-white/95 backdrop-blur-sm border-2 border-white/30 rounded-xl text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all shadow-xl hover:shadow-2xl group-focus-within:bg-white"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex justify-center items-center space-x-8 mt-12 text-gray-600">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{blogPosts.length}+</div>
                  <div className="text-sm">Articles</div>
                </div>
                <div className="w-px h-8 bg-gray-300"></div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{categories.length}</div>
                  <div className="text-sm">Categories</div>
                </div>
                <div className="w-px h-8 bg-gray-300"></div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{tags.length}+</div>
                  <div className="text-sm">Topics</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Featured Posts */}
        {featuredPosts.length > 0 && selectedCategory === 'All' && selectedTags.length === 0 && !searchQuery && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-4">
                Featured Articles
              </h2>
              <p className="text-gray-600 text-lg max-w-2xl mx-auto">
                Discover our most popular and impactful content on AI innovation and privacy technology.
              </p>
            </div>
            <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-8">
              {featuredPosts.map((post) => (
                <BlogCard key={post.id} post={post} featured />
              ))}
            </div>
          </section>
        )}

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <div className="grid lg:grid-cols-4 gap-8">
            {/* Enhanced Sidebar - Filters */}
            <div className="lg:col-span-1">
              <div className="sticky top-32">
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
                  <BlogFilters
                    categories={categories}
                    tags={tags}
                    selectedCategory={selectedCategory}
                    selectedTags={selectedTags}
                    onCategoryChange={handleCategoryChange}
                    onTagToggle={handleTagToggle}
                    onClearFilters={handleClearFilters}
                  />
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-3">
              {/* Enhanced Results Header */}
              <div className="flex items-center justify-between mb-8 p-6 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/50">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {selectedCategory !== 'All' || selectedTags.length > 0 || searchQuery 
                      ? 'Filtered Results' 
                      : 'All Articles'
                    }
                  </h2>
                  <p className="text-gray-600 mt-1 flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {filteredPosts.length} article{filteredPosts.length !== 1 ? 's' : ''} found
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'readingTime')}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="readingTime">Shortest Read</option>
                  </select>
                  {(selectedCategory !== 'All' || selectedTags.length > 0 || searchQuery) && (
                    <button
                      onClick={handleClearFilters}
                      className="px-4 py-2 text-sm font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>

              {/* Posts Grid */}
              {filteredPosts.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-8">
                  {filteredPosts.map((post) => (
                    <BlogCard key={post.id} post={post} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50">
                  <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full flex items-center justify-center">
                    <svg className="w-12 h-12 text-primary/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No articles found</h3>
                  <p className="text-gray-600 mb-6">
                    Try adjusting your filters or search terms to find what you&apos;re looking for.
                  </p>
                  <button
                    onClick={handleClearFilters}
                    className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:shadow-lg transition-all font-medium"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Newsletter Subscription */}
        <section className="bg-gradient-to-br from-white via-primary-50/30 to-secondary-50/30 border-t border-primary/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
            <div className="relative bg-gradient-to-br from-primary via-primary/95 to-secondary rounded-3xl p-8 lg:p-12 text-center overflow-hidden shadow-2xl">
              {/* Background decoration */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 left-0 w-full h-full neural-bg"></div>
              </div>
              <div className="absolute top-4 right-4 w-32 h-32 bg-accent/20 rounded-full blur-xl"></div>
              <div className="absolute bottom-4 left-4 w-24 h-24 bg-white/20 rounded-full blur-xl"></div>
              
              <div className="relative">
                <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white/90 text-sm font-medium mb-6">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Stay Connected
                </div>
                
                <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
                  Stay Updated with AI Insights
                </h2>
                <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
                  Get the latest articles on AI privacy, local processing, and productivity tips delivered to your inbox.
                </p>
                <div className="max-w-md mx-auto flex flex-col sm:flex-row gap-4">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    className="flex-1 px-4 py-3 rounded-lg border-2 border-white/30 bg-white/10 backdrop-blur-sm text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all"
                  />
                  <button className="px-6 py-3 bg-white text-primary font-semibold rounded-lg hover:bg-gray-100 hover:shadow-lg transition-all transform hover:scale-105">
                    Subscribe
                  </button>
                </div>
                <p className="text-sm text-white/70 mt-4">
                  No spam. Unsubscribe at any time.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
} 