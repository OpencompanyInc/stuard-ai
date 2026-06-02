import Link from 'next/link';
import Image from 'next/image';
import { BlogPost } from '@/lib/blogData';

interface BlogCardProps {
  post: BlogPost;
  featured?: boolean;
}

const BlogCard: React.FC<BlogCardProps> = ({ post, featured = false }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (featured) {
    return (
      <article className="group relative bg-[#111111] rounded-2xl border border-white/10 hover:border-[#FF383C]/40 transition-all duration-300 overflow-hidden">
        <Link href={`/blog/${post.slug}`}>
          <div className="aspect-[16/9] bg-gradient-primary relative overflow-hidden">
            {post.image ? (
              <Image
                src={post.image}
                alt={post.title}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-16 h-16 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute top-4 left-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-white/20 text-white backdrop-blur-sm">
                Featured
              </span>
            </div>
          </div>
          
          <div className="p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#FF383C]/15 text-[#FF6B6E]">
                {post.category}
              </span>
              <span className="text-sm text-[#737373]">{formatDate(post.publishedAt)} • {post.readingTime} min</span>
            </div>
            
            <h2 className="text-xl font-bold text-white mb-3 group-hover:text-[#FF6B6E] transition-colors line-clamp-2">
              {post.title}
            </h2>
            
            <p className="text-[#A3A3A3] mb-4 line-clamp-3">
              {post.excerpt}
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {post.author.avatar ? (
                  <Image src={post.author.avatar} alt={post.author.name} width={32} height={32} className="rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {post.author.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-white">{post.author.name}</p>
                  <p className="text-xs text-[#737373]">{post.readingTime} min read</p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-1">
                {post.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2 py-1 rounded text-xs bg-white/5 text-[#A3A3A3]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Link>
      </article>
    );
  }

  return (
    <article className="group bg-[#111111] rounded-xl border border-white/10 hover:border-[#FF383C]/40 transition-all duration-300 overflow-hidden">
      <Link href={`/blog/${post.slug}`}>
        <div className="aspect-[16/10] bg-gradient-primary relative overflow-hidden">
          {post.image ? (
            <Image
              src={post.image}
              alt={post.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-12 h-12 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        </div>
        
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#FF383C]/10 text-[#FF6B6E]">
              {post.category}
            </span>
            <span className="text-xs text-[#737373]">{formatDate(post.publishedAt)} • {post.readingTime} min</span>
          </div>
          
          <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-[#FF6B6E] transition-colors line-clamp-2">
            {post.title}
          </h3>
          
          <p className="text-[#A3A3A3] text-sm mb-4 line-clamp-2">
            {post.excerpt}
          </p>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {post.author.avatar ? (
                <Image src={post.author.avatar} alt={post.author.name} width={24} height={24} className="rounded-full object-cover" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-primary flex items-center justify-center">
                  <span className="text-white text-xs font-medium">
                    {post.author.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-white">{post.author.name}</p>
                <p className="text-xs text-[#737373]">{post.readingTime} min read</p>
              </div>
            </div>
            
            <div className="flex items-center text-[#FF6B6E] group-hover:translate-x-1 transition-transform">
              <span className="text-sm font-medium mr-1">Read more</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
};

export default BlogCard; 