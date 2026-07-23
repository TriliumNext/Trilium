import "./WizardModal.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";

import { t } from "../../services/i18n";
import Button from "./Button";
import Modal, { type ModalProps } from "./Modal";

export interface WizardStep<Id extends string = string> {
    id: Id;
    /** The modal's title while this step is shown. */
    title: string;
    content: ComponentChildren;
    /**
     * Whether the wizard may leave this step, blocking both the primary button and
     * Enter. Defaults to `true`.
     */
    canContinue?: boolean;
    /**
     * Hides the primary button because the step commits itself — picking one of a set
     * of cards, say, where "Next" would only be a second way to do what the click has
     * already done. Enter still advances, subject to {@link canContinue}, so the
     * keyboard path doesn't dead-end.
     */
    autoAdvance?: boolean;
    /** Primary button label, where neither "Next" nor the wizard's finish label fits. */
    nextLabel?: string;
}

export interface WizardModalProps<Id extends string>
    extends Pick<ModalProps, "size" | "maxWidth" | "minWidth" | "show" | "stackable" | "helpPageId" | "zIndex" | "onHidden" | "onShown"> {
    className?: string;
    /** In the order they are visited. Must not be empty. */
    steps: WizardStep<Id>[];
    /** The step being shown. The wizard is controlled: the caller owns this. */
    step: Id;
    onStepChange: (step: Id) => void;
    /**
     * The step the wizard opened on. Everything before it is unreachable and Back
     * turns into Cancel there, which is how a wizard reopened over its own result
     * skips the choices that are already fixed. Defaults to the first step.
     */
    entryStep?: Id;
    /** Primary button label on the last step, e.g. "Add provider". */
    finishLabel: string;
    /** The last step's primary action.  */
    onFinish: () => void;
}

/**
 * A modal that walks through a fixed sequence of steps, keeping one frame while it
 * does: the body holds a constant height and scrolls, so Back and Next stay put
 * instead of jumping as a step with a long list gives way to one with a single
 * field. Set `--wizard-body-height` on the modal to size that frame for the content
 * (see the stylesheet).
 *
 * The wizard owns only the navigation — which step is next, whether Back exists,
 * what the buttons say. Everything else stays with the caller, including the step
 * state itself, so that a step can advance on its own (see {@link WizardStep.autoAdvance}).
 */
export default function WizardModal<Id extends string>({
    steps, step, onStepChange, entryStep, finishLabel, onFinish, className, onHidden, ...modalProps
}: WizardModalProps<Id>) {
    const { index, previousStep, nextStep, position, total } = wizardNavigation(steps.map(s => s.id), step, entryStep);
    const current = steps[index];
    if (!current) {
        return null;
    }
    const canContinue = current.canContinue ?? true;

    function submit() {
        if (!canContinue) {
            return;
        }
        if (nextStep) {
            onStepChange(nextStep);
        } else {
            onFinish();
        }
    }

    return (
        <Modal
            {...modalProps}
            className={clsx("wizard-modal", className)}
            title={current.title}
            onHidden={onHidden}
            onSubmit={submit}
            // The constant body height is what keeps the frame still; scrolling is how
            // a step taller than that frame stays reachable.
            scrollable
            header={total > 1 && <WizardProgress position={position} total={total} />}
            footer={<>
                <Button
                    text={previousStep ? t("wizard.back") : t("modal.cancel")}
                    onClick={previousStep ? () => onStepChange(previousStep) : onHidden}
                />
                {!current.autoAdvance && (
                    <Button
                        kind="primary"
                        disabled={!canContinue}
                        text={current.nextLabel ?? (nextStep ? t("wizard.next") : finishLabel)}
                    />
                )}
            </>}
        >
            {current.content}
        </Modal>
    );
}

/**
 * Where the wizard stands: the steps either side of the current one, and its place
 * among those that can actually be reached. Split out from the component because it
 * is the whole of the navigation logic and is worth testing without a DOM.
 *
 * Both ids are clamped rather than trusted: an id outside the list — or one before
 * the entry step, which the user could never have walked to — would otherwise leave
 * the dialog with no content to render.
 */
export function wizardNavigation<Id extends string>(stepIds: Id[], step: Id, entryStep?: Id) {
    const lastIndex = stepIds.length - 1;
    // `clamp` guards the empty-list case too, where lastIndex is -1.
    const clamp = (value: number) => Math.min(Math.max(value, 0), Math.max(lastIndex, 0));
    const entryIndex = clamp(entryStep ? stepIds.indexOf(entryStep) : 0);
    const index = clamp(Math.max(stepIds.indexOf(step), entryIndex));

    return {
        index,
        /** The step Back returns to, or undefined where Back becomes Cancel. */
        previousStep: index > entryIndex ? stepIds[index - 1] : undefined,
        /** The step the primary button advances to, or undefined on the last one (where it finishes). */
        nextStep: index < lastIndex ? stepIds[index + 1] : undefined,
        /** 1-based position among the reachable steps. */
        position: index - entryIndex + 1,
        /** How many steps are reachable from where the wizard opened. */
        total: stepIds.length - entryIndex
    };
}

/**
 * How far along the wizard is, shown beside the title. Dots rather than "2 of 3" so
 * it stays a glance rather than something to read, with the count left to the label
 * screen readers get.
 */
function WizardProgress({ position, total }: { position: number; total: number }) {
    return (
        <div
            className="wizard-progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={position}
            aria-label={t("wizard.step_progress", { current: position, total })}
        >
            {Array.from({ length: total }, (_, i) => (
                <span key={i} className={clsx("wizard-progress-dot", { current: i + 1 === position, visited: i + 1 < position })} />
            ))}
        </div>
    );
}
