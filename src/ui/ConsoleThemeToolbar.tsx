import { useLayoutEffect, useRef, type FormEvent } from "react";
import { Link, Moon, Plus, Sun } from "lucide-react";
import { IconButton } from "./IconButton";

export type GuiConsoleTheme = "dark" | "light";

/** Dispatched on URL row submit; `event.detail` is `{ url: string }`. */
export const FLUFFYGRASS_URL_SUBMIT_EVENT = "fluffygrass:url-submit";

export type ConsoleThemeToolbarProps = {
	theme: GuiConsoleTheme;
	/** Cycles light ↔ dark GUI and sky (same as `skySystem.toggleMode()` / M N keys). */
	onToggle: () => void;
	urlSubmitExpanded: boolean;
	onRequestUrlSubmitExpand: () => void;
	urlDraft: string;
	onUrlDraftChange: (value: string) => void;
	/** Only one toolbar instance should autofocus (e.g. floating vs in-panel). */
	autofocusUrlInput?: boolean;
};

export function ConsoleThemeToolbar({
	theme,
	onToggle,
	urlSubmitExpanded,
	onRequestUrlSubmitExpand,
	urlDraft,
	onUrlDraftChange,
	autofocusUrlInput = false,
}: ConsoleThemeToolbarProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useLayoutEffect(() => {
		if (urlSubmitExpanded && autofocusUrlInput) {
			inputRef.current?.focus();
		}
	}, [urlSubmitExpanded, autofocusUrlInput]);

	const onSubmitUrl = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const url = urlDraft.trim();
		console.log("[FluffyGrass] URL submit (preview)", url);
		window.dispatchEvent(
			new CustomEvent(FLUFFYGRASS_URL_SUBMIT_EVENT, {
				bubbles: true,
				detail: { url },
			})
		);
	};

	return (
		<>
			<div
				className="gui-console-theme-add-slot"
				data-expanded={urlSubmitExpanded ? "true" : "false"}
			>
				<div
					className={
						"gui-console-theme-add-layer gui-console-theme-add-layer--plus" +
						(urlSubmitExpanded ? " gui-console-theme-add-layer--hidden" : "")
					}
					aria-hidden={urlSubmitExpanded}
				>
					<IconButton
						className="icon-btn gui-console-theme-icon-btn"
						type="button"
						aria-label="Submit a link"
						title="Submit a link"
						onClick={(e) => {
							onRequestUrlSubmitExpand();
							const el = e.currentTarget;
							requestAnimationFrame(() => el.blur());
						}}
					>
						<Plus size={18} strokeWidth={2} />
					</IconButton>
				</div>
				<div
					className={
						"gui-console-theme-add-layer gui-console-theme-add-layer--url" +
						(urlSubmitExpanded ? "" : " gui-console-theme-add-layer--hidden")
					}
					aria-hidden={!urlSubmitExpanded}
				>
					<form
						className="fg-url-input-group"
						noValidate
						onSubmit={onSubmitUrl}
						aria-label="Link URL"
					>
						<span
							className="fg-url-input-group__addon fg-url-input-group__addon--leading"
							aria-hidden
						>
							<Link size={14} strokeWidth={2} />
						</span>
						<input
							ref={inputRef}
							type="url"
							name="fluffygrass-url"
							className="fg-url-input-group__field"
							placeholder="Submit a URL"
							autoComplete="off"
							spellCheck={false}
							value={urlDraft}
							onChange={(ev) => onUrlDraftChange(ev.target.value)}
							aria-label="Page or asset URL"
						/>
						<button
							type="submit"
							className="fg-url-input-group__addon fg-url-input-group__addon--trailing"
						>
							Send
						</button>
					</form>
				</div>
			</div>
			<IconButton
				className="icon-btn gui-console-theme-icon-btn"
				type="button"
				aria-label={
					theme === "light"
						? "Switch to dark mode"
						: "Switch to light mode"
				}
				title={
					theme === "light"
						? "Switch to dark mode"
						: "Switch to light mode"
				}
				onClick={(e) => {
					onToggle();
					const el = e.currentTarget;
					requestAnimationFrame(() => el.blur());
				}}
			>
				{theme === "dark" ? (
					<Moon size={18} strokeWidth={2} />
				) : (
					<Sun size={18} strokeWidth={2} />
				)}
			</IconButton>
		</>
	);
}
