import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

export const IconButton = forwardRef<
	HTMLButtonElement,
	ComponentPropsWithoutRef<"button">
>(function IconButton({ className, type = "button", children, ...rest }, ref) {
	return (
		<button
			ref={ref}
			type={type}
			className={["icon-btn", className].filter(Boolean).join(" ")}
			{...rest}
		>
			{children}
		</button>
	);
});
