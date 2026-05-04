import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "./IconButton";

export type SceneTransportBarProps = {
	playing: boolean;
	muted: boolean;
	onTogglePlay: () => void;
	onToggleMute: () => void;
};

export function SceneTransportBar({
	playing,
	muted,
	onTogglePlay,
	onToggleMute,
}: SceneTransportBarProps) {
	return (
		<>
			<IconButton
				className="icon-btn scene-transport__icon-btn scene-transport__icon-btn--primary"
				aria-pressed={playing}
				aria-label={
					playing
						? "Pause automatic camera rotation and music"
						: "Start automatic camera rotation and music"
				}
				onClick={onTogglePlay}
			>
				{playing ? <Pause size={20} strokeWidth={2} /> : <Play size={20} strokeWidth={2} />}
			</IconButton>
			{playing ? (
				<IconButton
					className="icon-btn scene-transport__icon-btn"
					aria-pressed={muted}
					aria-label={
						muted ? "Unmute background music" : "Mute background music"
					}
					onClick={onToggleMute}
				>
					{muted ? (
						<VolumeX size={20} strokeWidth={2} />
					) : (
						<Volume2 size={20} strokeWidth={2} />
					)}
				</IconButton>
			) : null}
		</>
	);
}
