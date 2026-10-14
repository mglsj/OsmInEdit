/**
 * Editor state shared by the UI: the OSM graph with its history, the features drawn on the
 * map, and the loading status of the visible area.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { MapLoader } from "#lib/api/map-loader.ts";
import type { Bbox, OsmApi } from "#lib/api/osm-api.ts";
import { buildFeatures } from "#lib/map/features.ts";
import { AVAILABLE_ICONS } from "#lib/map/style/icons.ts";
import { entityGeometry } from "#lib/osm/area.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { Graph } from "#lib/osm/graph.ts";
import { type Action, History } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { loadPresetIndex, loadSchemaUpgrades } from "#lib/presets/load.ts";
import {
	applyPreset,
	type Preset,
	type PresetGeometry,
	type PresetIndex,
} from "#lib/presets/presets.ts";
import { LOCAL_UPGRADES, type UpgradeRule } from "#lib/validation/upgrades.ts";
import { type Issue, validate } from "#lib/validation/validate.ts";

export type LoadStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	/** The view is too zoomed out to download data. */
	| { readonly kind: "zoom-in" }
	/** Some tiles failed; they are retried on the next move. */
	| { readonly kind: "error"; readonly failed: number };

export interface EditorOptions {
	readonly api: Pick<OsmApi, "loadMap" | "upload">;
	/** Data is only downloaded from this zoom level. */
	readonly minZoom: number;
}

export class Editor {
	/** Current graph; replaced (never mutated) on every change. */
	graph = $state.raw(Graph.fromEntities([]));
	status = $state.raw<LoadStatus>({ kind: "idle" });
	/** Presets, loaded in the background. */
	presets = $state.raw<PresetIndex | null>(null);
	readonly features = $derived(
		buildFeatures(this.graph, {
			icons: AVAILABLE_ICONS,
			presets: this.presets ?? undefined,
		}),
	);
	selectedId = $state<EntityId | null>(null);
	/** Tag upgrade rules: local ones at once, the schema's once loaded. */
	upgrades = $state.raw<readonly UpgradeRule[]>(LOCAL_UPGRADES);
	/** The selected entity, or null when nothing (or something deleted) is selected. */
	readonly selected = $derived(
		this.selectedId ? (this.graph.entity(this.selectedId) ?? null) : null,
	);

	#history = new History(this.graph);
	readonly #api: EditorOptions["api"];
	readonly #loader: MapLoader;
	readonly #minZoom: number;
	#loads = 0;

	constructor({ api, minZoom }: EditorOptions) {
		this.#minZoom = minZoom;
		this.#api = api;
		void loadPresetIndex().then((index) => (this.presets = index));
		void loadSchemaUpgrades().then(
			(rules) => (this.upgrades = [...LOCAL_UPGRADES, ...rules]),
		);
		this.#loader = new MapLoader({
			download: (bbox) => api.loadMap(bbox),
			onData: (entities) => this.#receive(entities),
		});
	}

	/** Downloads the data of the visible area, if zoomed in enough. */
	async loadView(bounds: Bbox, zoom: number): Promise<void> {
		if (zoom < this.#minZoom) {
			this.status = { kind: "zoom-in" };
			return;
		}
		this.#loads++;
		this.status = { kind: "loading" };
		const result = await this.#loader.load(bounds);
		this.#loads--;
		if (result.failed > 0) {
			this.status = { kind: "error", failed: result.failed };
		} else if (this.#loads === 0) {
			this.status = { kind: result.skipped ? "zoom-in" : "idle" };
		}
	}

	get canUndo(): boolean {
		void this.graph; // re-evaluate when the graph changes
		return this.#history.canUndo;
	}

	get canRedo(): boolean {
		void this.graph;
		return this.#history.canRedo;
	}

	/** Number of entities created, modified or deleted since the last upload. */
	get editCount(): number {
		const { created, modified, deleted } = this.graph.changes();
		return created.length + modified.length + deleted.length;
	}

	perform(action: Action, annotation: string): void {
		this.graph = this.#history.perform(action, annotation);
	}

	undo(): void {
		this.#history.undo();
		this.graph = this.#history.graph;
	}

	redo(): void {
		this.#history.redo();
		this.graph = this.#history.graph;
	}

	/** Problems of one entity. */
	issuesOf(id: EntityId): Issue[] {
		return validate(this.graph, [id], this.upgrades);
	}

	/** Problems of the entities edited since the last upload. */
	get editIssues(): Issue[] {
		const { created, modified } = this.graph.changes();
		return validate(
			this.graph,
			[...created, ...modified].map((e) => e.id),
			this.upgrades,
		);
	}

	fix(issue: Issue): void {
		if (issue.fix) this.perform(issue.fix.action, issue.fix.label);
	}

	/**
	 * Uploads the edits in one changeset, then starts a new history from the server's state.
	 * Returns the changeset id. On failure the edits are kept.
	 */
	async upload(changesetTags: Tags): Promise<number> {
		const result = await this.#api.upload(this.graph, changesetTags);
		this.#history = new History(result.graph);
		if (this.selectedId) {
			this.selectedId = result.idMap.get(this.selectedId) ?? this.selectedId;
		}
		this.graph = result.graph;
		return result.changesetId;
	}

	select(id: EntityId | null): void {
		this.selectedId = id;
	}

	geometryOf(entity: Entity): PresetGeometry {
		return entityGeometry(this.graph, entity);
	}

	presetOf(entity: Entity): Preset | undefined {
		return this.presets?.match(entity.tags, this.geometryOf(entity));
	}

	setTags(id: EntityId, tags: Tags): void {
		this.perform(changeTags(id, tags), "Change tags");
	}

	setPreset(entity: Entity, preset: Preset): void {
		const tags = applyPreset(entity.tags, this.presetOf(entity), preset);
		this.perform(changeTags(entity.id, tags), `Change to ${preset.name}`);
	}

	#receive(entities: Entity[]): void {
		this.#history.merge(entities);
		this.graph = this.#history.graph;
	}
}
