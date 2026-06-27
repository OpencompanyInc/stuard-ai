import React from "react";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const sizeMap = {
  sm: "max-w-3xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
};

export const Container: React.FC<ContainerProps> = ({ size = "2xl", className = "", children, ...props }) => {
  return (
    <div className={["mx-auto px-4 sm:px-6 lg:px-8", sizeMap[size], className].join(" ")} {...props}>
      {children}
    </div>
  );
};

export default Container;








