import { useId, type ReactNode } from 'react';
import { LabFrame, type LabFrameProps } from '../LabFrame';
import { communicationCopy } from './copy';

export type CommunicationLabFrameProps = LabFrameProps & {
  prediction?: ReactNode;
  observation: ReactNode;
  explanation: ReactNode;
};

/** Shared semantic reading order for the communication teaching labs. */
export function CommunicationLabFrame({ prediction, observation, explanation, children, ...frame }: CommunicationLabFrameProps) {
  const predictionId = useId();
  const tryId = useId();
  const observationId = useId();
  const explanationId = useId();
  const copy = communicationCopy[frame.lang];

  return <LabFrame {...frame}>
    {prediction == null ? null : <section className="communication-lab-prediction" aria-labelledby={predictionId}>
      <h4 id={predictionId}>{copy.predict}</h4>
      {prediction}
    </section>}
    <section className="communication-lab-try" aria-labelledby={tryId}>
      <h4 id={tryId}>{copy.try}</h4>
      {children}
    </section>
    <section className="communication-lab-observation" aria-labelledby={observationId}>
      <h4 id={observationId}>{copy.observe}</h4>
      {observation}
    </section>
    <section className="communication-lab-explanation" aria-labelledby={explanationId}>
      <h4 id={explanationId}>{copy.explain}</h4>
      {explanation}
    </section>
  </LabFrame>;
}
