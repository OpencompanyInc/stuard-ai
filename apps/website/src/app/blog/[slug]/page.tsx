import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReadingProgress from '@/components/blog/ReadingProgress';
import TableOfContents from '@/components/blog/TableOfContents';
import BlogCard from '@/components/blog/BlogCard';
import { getPostBySlug, getRelatedPosts } from '@/lib/blogData';
import { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const revalidate = false;

type RouteParams = { params: Promise<{ slug: string }> };

// Removed generateStaticParams to avoid SSG and force dynamic rendering

// Generate metadata for SEO
export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  
  if (!post) {
    return {
      title: 'Post Not Found | Stuard AI',
    };
  }

  return {
    title: post.seo?.metaTitle || post.title,
    description: post.seo?.metaDescription || post.excerpt,
    keywords: post.tags.join(', '),
    authors: [{ name: post.author.name }],
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
      authors: [post.author.name],
      tags: post.tags,
      images: post.image ? [
        {
          url: post.image,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
      images: post.image ? [post.image] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: RouteParams) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = getRelatedPosts(post);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatContent = (content: string) => {
    // Split content by lines and process
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    return lines.map((line, index) => {
      const trimmedLine = line.trim();
      
      // Handle headers
      if (trimmedLine.startsWith('# ')) {
        const text = trimmedLine.substring(2);
        const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
        return (
          <h1 id={id} key={index} className="text-4xl font-bold text-gray-900 mb-6 mt-8 first:mt-0 scroll-mt-24">
            {text}
          </h1>
        );
      } else if (trimmedLine.startsWith('## ')) {
        const text = trimmedLine.substring(3);
        const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
        return (
          <h2 id={id} key={index} className="text-3xl font-bold text-gray-900 mb-4 mt-8 scroll-mt-24">
            {text}
          </h2>
        );
      } else if (trimmedLine.startsWith('### ')) {
        const text = trimmedLine.substring(4);
        const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
        return (
          <h3 id={id} key={index} className="text-2xl font-semibold text-gray-900 mb-3 mt-6 scroll-mt-24">
            {text}
          </h3>
        );
      } else if (trimmedLine.startsWith('#### ')) {
        const text = trimmedLine.substring(5);
        const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
        return (
          <h4 id={id} key={index} className="text-xl font-semibold text-gray-900 mb-3 mt-6 scroll-mt-24">
            {text}
          </h4>
        );
      }
      // Handle bold text
      else if (trimmedLine.startsWith('- **') && trimmedLine.includes('**:')) {
        const match = trimmedLine.match(/- \*\*(.*?)\*\*: (.*)/);
        if (match) {
          return (
            <li key={index} className="mb-2">
              <strong className="font-semibold text-gray-900">{match[1]}</strong>: {match[2]}
            </li>
          );
        }
      }
      // Handle list items
      else if (trimmedLine.startsWith('- ')) {
        return (
          <li key={index} className="mb-2">
            {trimmedLine.substring(2)}
          </li>
        );
      }
      // Handle code blocks
      else if (trimmedLine.startsWith('```')) {
        const nextLines = [];
        let i = index + 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          nextLines.push(lines[i]);
          i++;
        }
        
        return (
          <pre key={index} className="bg-gray-100 p-4 rounded-lg overflow-x-auto mb-6 mt-4">
            <code className="text-sm font-mono text-gray-800">
              {nextLines.join('\n')}
            </code>
          </pre>
        );
      }
      // Handle tables (basic markdown table support)
      else if (trimmedLine.includes('|') && (trimmedLine.match(/\|/g) || []).length >= 2) {
        // This is a simple table row - in a real implementation you'd want better table parsing
        const cells = trimmedLine.split('|').map(cell => cell.trim()).filter(cell => cell);
        
        return (
          <div key={index} className="overflow-x-auto mb-4">
            <table className="min-w-full border border-gray-200">
              <tr>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-gray-200 px-4 py-2 text-sm">
                    {cell}
                  </td>
                ))}
              </tr>
            </table>
          </div>
        );
      }
      // Handle regular paragraphs
      else if (trimmedLine.length > 0) {
        return (
          <p key={index} className="mb-4 text-gray-700 leading-relaxed">
            {trimmedLine}
          </p>
        );
      }
      
      return null;
    }).filter(Boolean);
  };

  return (
    <>
      <ReadingProgress targetSelector="#article-root" />
      <div className="min-h-screen bg-white">
        {/* Breadcrumb */}
        <div className="bg-gray-50 border-b border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center space-x-2 text-sm">
              <Link href="/" className="text-gray-500 hover:text-primary transition-colors">
                Home
              </Link>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <Link href="/blog" className="text-gray-500 hover:text-primary transition-colors">
                Blog
              </Link>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-gray-900 font-medium">{post.title}</span>
            </nav>
          </div>
        </div>

        {/* Article Header */}
        <article className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <header className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gradient-accent text-white">
                {post.category}
              </span>
              {post.featured && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gradient-primary text-white">
                  Featured
                </span>
              )}
            </div>
            
            <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6 leading-tight">
              {post.title}
            </h1>
            
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              {post.excerpt}
            </p>
            
            <div className="flex items-center justify-between pb-8 border-b border-border">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {post.author.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{post.author.name}</p>
                  {post.author.bio && (
                    <p className="text-sm text-gray-600">{post.author.bio}</p>
                  )}
                </div>
              </div>
              
              <div className="text-right">
                <p className="text-sm text-gray-500">
                  Published {formatDate(post.publishedAt)}
                </p>
                <p className="text-sm text-gray-500">
                  {post.readingTime} min read
                </p>
              </div>
            </div>
          </header>

          {/* Article Content */}
          <div className="grid lg:grid-cols-[1fr_280px] gap-8">
            <div id="article-root" className="prose prose-lg max-w-none">
              {formatContent(post.content)}
            </div>
            <div>
              <TableOfContents />
            </div>
          </div>

          {/* Tags */}
          <div className="mt-12 pt-8 border-t border-border">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/blog?tag=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700 hover:bg-primary hover:text-white transition-colors"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>

          {/* Share */}
          <div className="mt-8 pt-8 border-t border-border">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Share this article</h3>
            <div className="flex space-x-4">
              <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                </svg>
                <span>Twitter</span>
              </button>
              <button className="flex items-center space-x-2 px-4 py-2 bg-blue-800 text-white rounded-lg hover:bg-blue-900 transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                <span>LinkedIn</span>
              </button>
              <button className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                <span>Copy Link</span>
              </button>
            </div>
          </div>
        </article>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <section className="bg-gray-50 border-t border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-8">Related Articles</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {relatedPosts.map((relatedPost) => (
                  <BlogCard key={relatedPost.id} post={relatedPost} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Newsletter CTA */}
        <section className="bg-white border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Enjoyed this article?
            </h2>
            <p className="text-xl text-gray-600 mb-8">
              Subscribe to get more insights on AI, privacy, and productivity delivered to your inbox.
            </p>
            <div className="max-w-md mx-auto flex flex-col sm:flex-row gap-4">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <button className="px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-colors">
                Subscribe
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
} 