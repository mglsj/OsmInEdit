/**
 * Checks entities for tagging problems. Each issue may carry a fix: a graph action, applied
 * through the history like any edit (so it can be undone).
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import {
	formatLevels,
	normalizeLevels,
	parseLevels,
} from "#lib/levels/levels.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { describeTags, type UpgradeRule, upgradeTags } from "./upgrades.ts";

export type IssueRule =
	| "outdated-tags"
	| "unreadable-level"
	| "vertical-repeat-on"
	| "door-not-on-wall";

export interface Issue {
	/** Stable id, `rule:entity`. */
	readonly id: string;
	readonly rule: IssueRule;
	readonly severity: "warning" | "error";
	readonly entityId: EntityId;
	readonly message: string;
	readonly fix?: { readonly label: string; readonly action: Action };
}

export function validate(
	graph: Graph,
	ids: Iterable<EntityId>,
	upgrades: readonly UpgradeRule[],
): Issue[] {
	const issues: Issue[] = [];
	for (const id of ids) {
		const entity = graph.entity(id);
		if (!entity) continue;
		issues.push(
			...outdatedTags(entity, upgrades),
			...levelIssues(entity),
			...doorIssues(graph, entity),
		);
	}
	return issues;
}

/** An issue; `key` tells apart issues of one rule on one entity (`level` and `repeat_on`). */
function issue(
	rule: IssueRule,
	entity: Entity,
	message: string,
	fix?: Issue["fix"],
	key?: string,
): Issue {
	return {
		id: `${rule}:${entity.id}${key ? `:${key}` : ""}`,
		rule,
		severity: "warning",
		entityId: entity.id,
		message,
		fix,
	};
}

function outdatedTags(
	entity: Entity,
	upgrades: readonly UpgradeRule[],
): Issue[] {
	const upgraded = upgradeTags(entity.tags, upgrades);
	if (upgraded === entity.tags) return [];
	const removed = only(entity.tags, (k) => upgraded[k] !== entity.tags[k]);
	const added = only(upgraded, (k) => upgraded[k] !== entity.tags[k]);
	return [
		issue("outdated-tags", entity, `Outdated tags: ${describeTags(removed)}`, {
			label: Object.keys(added).length
				? `Upgrade to ${describeTags(added)}`
				: `Remove ${describeTags(removed)}`,
			action: changeTags(entity.id, upgraded),
		}),
	];
}

const VERTICAL_HIGHWAYS = new Set(["elevator", "steps"]);

/** Stairs, elevators and escalators span levels rather than repeat on them. */
function isVertical(tags: Tags): boolean {
	return (
		tags.stairs === "yes" ||
		tags.elevator === "yes" ||
		(tags.highway !== undefined && VERTICAL_HIGHWAYS.has(tags.highway)) ||
		tags.conveying !== undefined
	);
}

function levelIssues(entity: Entity): Issue[] {
	const issues: Issue[] = [];
	for (const key of ["level", "repeat_on"] as const) {
		const value = entity.tags[key];
		if (value === undefined || parseLevels(value)) continue;
		const hint = value.includes(",")
			? " Separate levels with ; (e.g. 0;1) and write decimals with . (e.g. 0.5)."
			: " Use numbers like 0, -1, 0.5, lists like 0;1 or ranges like 0-2.";
		issues.push(
			issue(
				"unreadable-level",
				entity,
				`${key}=${value} can't be read.${hint}`,
				undefined,
				key,
			),
		);
	}

	const level =
		entity.tags.level === undefined ? [] : parseLevels(entity.tags.level);
	const repeatOn = entity.tags.repeat_on
		? parseLevels(entity.tags.repeat_on)
		: null;
	if (isVertical(entity.tags) && level && repeatOn) {
		const { repeat_on: _, ...rest } = entity.tags;
		const tags = {
			...rest,
			level: formatLevels(normalizeLevels([...level, ...repeatOn])),
		};
		issues.push(
			issue(
				"vertical-repeat-on",
				entity,
				"Stairs and elevators connect levels: list them all in level, not in repeat_on.",
				{
					label: `Set level=${tags.level}`,
					action: changeTags(entity.id, tags),
				},
			),
		);
	}
	return issues;
}

function doorIssues(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "node" || entity.tags.door === undefined) return [];
	if (graph.parentWays(entity.id).length > 0) return [];
	return [
		issue(
			"door-not-on-wall",
			entity,
			"This door is not on a wall or room outline, so routing can't go through it.",
		),
	];
}

function only(tags: Tags, keep: (key: string) => boolean): Tags {
	return Object.fromEntries(Object.entries(tags).filter(([k]) => keep(k)));
}
