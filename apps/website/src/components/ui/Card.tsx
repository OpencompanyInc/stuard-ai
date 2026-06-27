import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

export const Card: React.FC<CardProps> = ({ as: Tag = "div", className = "", children, ...props }) => {
  return (
    <Tag
      className={[
        "bg-[#111111] rounded-2xl border border-white/10",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </Tag>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div className={["px-6 pt-6", className].join(" ")} {...props} />
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className = "", ...props }) => (
  <h3 className={["text-xl font-bold text-white", className].join(" ")} {...props} />
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className = "", ...props }) => (
  <p className={["text-[#A3A3A3]", className].join(" ")} {...props} />
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div className={["px-6 pb-6", className].join(" ")} {...props} />
);

export default Card;








