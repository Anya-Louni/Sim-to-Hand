# Related work

Checked October 2026. Summaries come from abstracts, project pages and the FailBench HTML paper. I did not read every paper in full.

## VLM judges of robot success and failure

**FailBench** ([arXiv 2609.03611](https://arxiv.org/abs/2609.03611), Metric AI Lab, 2026). 2,197 attempts from 14 public sources (12 real, 2 sim), 13 VLM detectors. Best mean balanced accuracy 0.77. Detection nears saturation when success shows up as object motion and nears chance when success depends on contact: on the REASSEMBLE contact-rich assembly subset (124 samples) no model exceeds 0.60, mean 0.52 (Gemini 3 Flash 0.60, Gemma-4-31B-it 0.58, GPT-4o 0.54). Models lean toward predicting success under ambiguous evidence. Every number uses vision and the instruction only; the authors name force-torque and audio as future work, although four of their sources record force-torque or audio.
*Data and harness:* project page lists code, dataset and leaderboard as "soon"; no download today. Stated license: that of each underlying source.

**Guardian** ([arXiv 2512.01946](https://arxiv.org/abs/2512.01946), Pacaud, Garcia, Chen, Schmid; v3 retitled "Scaling Cross-Environment Failure Reasoning Data for Vision-Language Robotic Manipulation"). Perturbs successful trajectories in RLBench and BridgeData V2 to make planning and execution failures (FailCoT), trains a multi-view reasoning VLM, reports state of the art on RoboFail, RoboVQA and a new real benchmark, UR5-Fail. Vision only.

**RoboFAC** ([arXiv 2505.12224](https://arxiv.org/abs/2505.12224)). 9,440 failure trajectories, 78k QA pairs, a six-type failure taxonomy (planning, motion, execution including grasping errors). Fine-tunes Qwen2.5-VL; reports +34.1% over GPT-4o on its own benchmark. Vision only.

**AHA** ([arXiv 2410.00371](https://arxiv.org/abs/2410.00371), ICLR 2025). FailGen perturbs simulated demos to create failures; a fine-tuned VLM detects and explains them and transfers to real datasets. Vision only.

**FAER.** I could not find a paper by this name. Nearest matches: FLARE ([arXiv 2608.26645](https://arxiv.org/abs/2608.26645), failure-aware recovery) and Fail-RAG ([arXiv 2606.19598](https://arxiv.org/abs/2606.19598), retrieval for failure identification). Please send the full title if you meant something else.

Other vision-centric detectors: I-FailSense ([arXiv 2509.16072](https://arxiv.org/abs/2509.16072)), ARMOR ([arXiv 2602.12405](https://arxiv.org/abs/2602.12405)), SAFE ([arXiv 2506.09937](https://arxiv.org/abs/2506.09937), uses VLA policy internals, not a judge).

## Force, touch and proprioception

**REASSEMBLE** ([arXiv 2502.05086](https://arxiv.org/abs/2502.05086), [data](https://researchdata.tuwien.ac.at/records/0ewrv-8cb44), CC BY 4.0). 4,551 contact-rich assembly demos (4,035 successful) on the NIST task board with multi-view RGB, wrist force-torque, proprioception, audio and event cameras, plus a success flag per segment. It is the source of FailBench's contact subset. Download is one 54.8 GB archive.

**ForceBench** ([arXiv 2610.19604](https://arxiv.org/abs/2610.19604)). Sim benchmark for wrist force in VLA policies. Policy learning, not success judging.

**Feel the Force** ([arXiv 2506.01944](https://arxiv.org/abs/2506.01944)), **TacVLA** ([arXiv 2603.12665](https://arxiv.org/abs/2603.12665)), **DreamTacVLA** ([arXiv 2512.23864](https://arxiv.org/abs/2512.23864)). Force or touch inside control policies; they report vision-only baselines struggle on insertion and force-sensitive tasks. Not detectors.

**Watchdog / physical agentic loop** ([arXiv 2604.07395](https://arxiv.org/abs/2604.07395)). Turns noisy gripper telemetry into grasp outcome labels on a mobile manipulator. No VLM-judge comparison and no quantitative metrics on the abstract page.

**Classical multimodal anomaly detection**, for example Park, Hoshi and Kemp, RA-L 2018 (LSTM-VAE over force, sound and kinematics for robot-assisted feeding). Shows non-visual signals catch execution anomalies. Predates VLM judges.

## Where this project differs

1. **Head-to-head.** No work found compares cheap non-visual sensors against VLM judges on the same attempts. FailBench names this as open.
2. **Minimal pairs.** Existing benchmarks use natural failures. Here each failure has a near-identical success twin with a measured pixel difference, which isolates contact from other visual cues.
3. **Cheap, degraded sensors.** A contact switch, gripper effort and one force axis, with a tunable noise model (noise, 8 to 10 bit quantization, drift, latency, dropouts), not lab-grade force-torque.
4. **Adversarial physical search.** "Millimeters to fool" per model, with transfer across models and to the sensor classifier.

**The vision half of our claim is not new.** FailBench already shows VLMs near chance on contact tasks in real data. Our contribution is the controlled sim version, the sensor side, the fusion and the attacker. The README and report will say so.

## Comparability with FailBench

- FailBench data is not public yet, so we cannot report on its contact subset today. We will re-check before writing the report.
- Closest substitute: run the same judges and a sensor classifier on a REASSEMBLE sample, using its real force-torque signals. This needs selective reads from the 54.8 GB archive or a free Kaggle/Colab notebook, since the laptop has 33 GB free disk. Optional, decided later.
