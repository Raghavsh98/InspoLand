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
				<span className="fg-icon-btn-shortcut">
					<span className="scene-transport__play-morph" aria-hidden>
						<span
							className={
								"scene-transport__play-morph-icon" +
								(playing ? "" : " scene-transport__play-morph-icon--active")
							}
						>
							<Play size={20} strokeWidth={2} />
						</span>
						<span
							className={
								"scene-transport__play-morph-icon" +
								(playing ? " scene-transport__play-morph-icon--active" : "")
							}
						>
							<Pause size={20} strokeWidth={2} />
						</span>
					</span>
					<span className="fg-icon-btn-shortcut__hint" aria-hidden>
						P
					</span>
				</span>
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
					<span className="fg-icon-btn-shortcut">
						{muted ? (
							<VolumeX size={20} strokeWidth={2} />
						) : (
							<Volume2 size={20} strokeWidth={2} />
						)}
						<span className="fg-icon-btn-shortcut__hint" aria-hidden>
							S
						</span>
					</span>
				</IconButton>
			) : null}
		</>
	);
}
