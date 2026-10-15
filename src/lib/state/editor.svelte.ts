/**
 * Editor state shared by the UI: the OSM graph with its history, the features drawn on the
 * map, and the loading status of the visible area.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { MapLoader } from "#lib/api/map-loader.ts";
import type { Bbox, OsmApi } from "#lib/api/osm-api.ts";
import type { OsmWikibase } from "#lib/api/osm-wikibase.ts";
import type { Taginfo } from "#lib/api/taginfo.ts";
import type { Wikidata } from "#lib/api/wikidata.ts";
import { buildFeatures } from "#lib/map/features.ts";
import { AVAILABLE_ICONS } from "#lib/map/style/icons.ts";
import { entityGeometry } from "#lib/osm/area.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { Graph } from "#lib/osm/graph.ts";
import { type Action, History } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { loadPresetIndex, loadSchemaUpgrades } from "#lib/presets/load.ts";
import type {
	Preset,
	PresetGeometry,
	PresetIndex,
} from "#lib/presets/presets.ts";
import { RecentPresets } from "#lib/presets/recent.ts";
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
	/** Value suggestions for combo fields; none without it. */
	readonly taginfo?: Pick<Taginfo, "values" | "multikeys">;
	/** Tag documentation for the ⓘ buttons; none without it. */
	readonly wikibase?: Pick<OsmWikibase, "docs">;
	/** Wikidata items, for the wikidata and wikipedia fields. */
	readonly wikidata?: Pick<Wikidata, "search" | "entity" | "itemsByTitle">;
	/** Wikipedia article titles for a language and a text. */
	readonly searchWikipedia?: (lang: string, query: string) => Promise<string[]>;
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
	/** The feature types chosen last, offered first in the type list. */
	readonly recentPresets = new RecentPresets(browserStorage());
	/** Tag upgrade rules: local ones at once, the schema's once loaded. */
	upgrades = $state.raw<readonly UpgradeRule[]>(LOCAL_UPGRADES);
	/** The selected entity, or null when nothing (or something deleted) is selected. */
	readonly selected = $derived(
		this.selectedId ? (this.graph.entity(this.selectedId) ?? null) : null,
	);

	/** Values the schema deprecates, by key: combo fields never suggest them. */
	readonly deprecatedValues = $derived.by(() => {
		const byKey = new Map<string, string[]>();
		for (const { old } of this.upgrades) {
			const entries = Object.entries(old);
			if (entries.length !== 1) continue;
			const [key, value] = entries[0] as [string, string];
			if (value === "*") continue;
			byKey.set(key, [...(byKey.get(key) ?? []), value]);
		}
		return byKey;
	});
	readonly taginfo: EditorOptions["taginfo"];
	readonly wikibase: EditorOptions["wikibase"];
	readonly wikidata: EditorOptions["wikidata"];
	readonly searchWikipedia: EditorOptions["searchWikipedia"];

	#history = new History(this.graph);
	readonly #api: EditorOptions["api"];
	readonly #loader: MapLoader;
	readonly #minZoom: number;
	#loads = 0;

	constructor({
		api,
		minZoom,
		taginfo,
		wikibase,
		wikidata,
		searchWikipedia,
	}: EditorOptions) {
		this.#minZoom = minZoom;
		this.taginfo = taginfo;
		this.wikibase = wikibase;
		this.wikidata = wikidata;
		this.searchWikipedia = searchWikipedia;
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
	readonly editCount = $derived.by(() => {
		const { created, modified, deleted } = this.graph.changes();
		return created.length + modified.length + deleted.length;
	});

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

	/** An entity's tags as downloaded, or undefined for a new feature (for a field's revert). */
	downloadedTags(id: EntityId): Tags | undefined {
		return this.#history.base.entity(id)?.tags;
	}

	/**
	 * Changes tags in the last undo step, as iD does with tags looked up after an edit (the
	 * Wikipedia article of a Wikidata item). Only while the graph is still `after`, the graph
	 * that edit made: anything done since wins.
	 */
	amendTags(
		after: Graph,
		id: EntityId,
		patch: (tags: Tags) => Tags | null,
	): void {
		if (this.graph !== after) return;
		const entity = this.graph.entity(id);
		const tags = entity && patch(entity.tags);
		if (!tags) return;
		this.graph = this.#history.replace(changeTags(id, tags));
	}

	setTags(id: EntityId, tags: Tags): void {
		this.perform(changeTags(id, tags), "Change tags");
	}

	setPreset(entity: Entity, preset: Preset): void {
		const geometry = this.geometryOf(entity);
		const tags =
			this.presets?.changePreset(
				entity.tags,
				this.presetOf(entity),
				preset,
				geometry,
			) ?? entity.tags;
		this.perform(changeTags(entity.id, tags), `Change to ${preset.name}`);
		this.recentPresets.add(preset.id, geometry);
	}

	#receive(entities: Entity[]): void {
		this.#history.merge(entities);
		this.graph = this.#history.graph;
	}
}

/** The browser's localStorage, or a stand-in that keeps nothing where it is unavailable. */
function browserStorage(): Pick<Storage, "getItem" | "setItem"> {
	try {
		return globalThis.localStorage ?? NO_STORAGE;
	} catch {
		return NO_STORAGE;
	}
}

const NO_STORAGE = { getItem: () => null, setItem: () => {} };
