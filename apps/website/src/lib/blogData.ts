export type BlogAuthor = {
  name: string;
  avatar?: string;
  bio?: string;
};

export type BlogSEO = {
  metaTitle?: string;
  metaDescription?: string;
};

export type BlogPost = {
  id?: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  author: BlogAuthor;
  publishedAt: string;
  updatedAt?: string;
  readingTime: number;
  image?: string;
  featured?: boolean;
  seo?: BlogSEO;
};

export const blogPosts: BlogPost[] = [];

export function getFeaturedPosts(): BlogPost[] {
  return blogPosts.filter((p) => p.featured).slice(0, 3);
}

export function getAllCategories(): string[] {
  const categories = new Set<string>();
  for (const post of blogPosts) categories.add(post.category);
  return Array.from(categories).sort();
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const post of blogPosts) {
    for (const tag of post.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
}

export function getPostsByCategory(category: string): BlogPost[] {
  return blogPosts.filter((p) => p.category === category);
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getRelatedPosts(post: BlogPost): BlogPost[] {
  const related = blogPosts
    .filter((p) => p.slug !== post.slug)
    .map((p) => {
      const tagOverlap = p.tags.filter((t) => post.tags.includes(t)).length;
      const categoryBoost = p.category === post.category ? 2 : 0;
      return { post: p, score: tagOverlap + categoryBoost };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.post);

  if (related.length > 0) return related;
  return blogPosts.filter((p) => p.slug !== post.slug).slice(0, 3);
}
