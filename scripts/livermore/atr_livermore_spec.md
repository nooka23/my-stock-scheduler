# ATR-Adapted Livermore Record Rules

## Threshold Mapping

- `reversal_threshold = ATR20 * reversalMultiplier`
- `confirm_threshold = ATR20 * confirmMultiplier`
- Livermore 원문의 `6-point reaction/rally`는 `reversal_threshold`로 치환한다.
- Livermore 원문의 `3-point carry-through / failure`는 `confirm_threshold`로 치환한다.

## Columns / States

- `upward_trend`
- `downward_trend`
- `natural_rally`
- `natural_reaction`
- `secondary_rally`
- `secondary_reaction`

## Pivot Definitions

- `SS`
  - 상승추세에서 마지막으로 기록된 가격
  - `upward_trend -> natural_reaction` 또는 `upward_trend -> downward_trend` 로 처음 벗어나는 날 확정된다.
  - 원문의 "last recorded price in the Upward Trend column with red lines underneath"

- `BB`
  - 하락추세에서 마지막으로 기록된 가격
  - `downward_trend -> natural_rally` 또는 `downward_trend -> upward_trend` 로 처음 벗어나는 날 확정된다.
  - 원문의 "last recorded price in the Downward Trend column with black lines underneath"

- `S`
  - 통상반등에서 마지막으로 기록된 가격
  - `natural_rally -> natural_reaction` 또는 `natural_rally -> downward_trend` 로 벗어나는 날 확정된다.
  - 원문의 "last recorded price in the Natural Rally column with black lines underneath"

- `B`
  - 통상조정에서 마지막으로 기록된 가격
  - `natural_reaction -> natural_rally` 또는 `natural_reaction -> upward_trend` 로 벗어나는 날 확정된다.
  - 원문의 "last recorded price in the Natural Reaction column with red lines underneath"

## Transition Table

| Current state | Continue recording while | Reversal threshold hit | Confirm threshold usage |
| --- | --- | --- | --- |
| `upward_trend` | 현재 가격이 직전 `upward_trend` 기록가보다 높을 때 같은 열에 계속 기록 | 마지막 `upward_trend` 기록가에서 `reversal_threshold` 이상 하락하면 `natural_reaction` 시작, 동시에 `SS` 확정 | 이후 자연조정/반등 전개가 끝난 뒤 이전 `SS`를 `confirm_threshold` 이상 돌파하면 상승 재개 판정에 사용 |
| `downward_trend` | 현재 가격이 직전 `downward_trend` 기록가보다 낮을 때 같은 열에 계속 기록 | 마지막 `downward_trend` 기록가에서 `reversal_threshold` 이상 반등하면 `natural_rally` 시작, 동시에 `BB` 확정 | 이후 자연반등/조정 전개가 끝난 뒤 이전 `BB`를 `confirm_threshold` 이상 하향 돌파하면 하락 재개 판정에 사용 |
| `natural_reaction` | 현재 가격이 직전 `natural_reaction` 기록가보다 낮을 때 같은 열에 계속 기록 | 마지막 `natural_reaction` 기록가에서 `reversal_threshold` 이상 반등하면 `natural_rally` 또는 `secondary_rally` 시작, 동시에 `B` 확정 | 반등 가격이 이전 `S` 또는 `SS`를 `confirm_threshold` 이상 넘는지에 따라 `natural_rally` vs `upward_trend` 판정 |
| `natural_rally` | 현재 가격이 직전 `natural_rally` 기록가보다 높을 때 같은 열에 계속 기록 | 마지막 `natural_rally` 기록가에서 `reversal_threshold` 이상 하락하면 `natural_reaction` 또는 `secondary_reaction` 시작, 동시에 `S` 확정 | 하락 가격이 이전 `B` 또는 `BB`를 `confirm_threshold` 이상 깨는지에 따라 `natural_reaction` vs `downward_trend` 판정 |
| `secondary_rally` | 현재 가격이 직전 `secondary_rally` 기록가보다 높을 때 같은 열에 계속 기록 | 별도 새 열 시작 없음. 이전 `natural_rally` 피벗을 회복할 때까지 유지 | 이전 `S`를 넘지 못하면 계속 `secondary_rally`, 이전 `S`를 회복하면 `natural_rally`, 이전 `SS`를 `confirm_threshold` 이상 넘으면 `upward_trend` 후보 |
| `secondary_reaction` | 현재 가격이 직전 `secondary_reaction` 기록가보다 낮을 때 같은 열에 계속 기록 | 별도 새 열 시작 없음. 이전 `natural_reaction` 피벗을 이탈할 때까지 유지 | 이전 `B`를 깨지 못하면 계속 `secondary_reaction`, 이전 `B`를 이탈하면 `natural_reaction`, 이전 `BB`를 `confirm_threshold` 이상 깨면 `downward_trend` 후보 |

## Practical Decision Rules

- `upward_trend` 재개
  - 자연반등 이후 가격이 이전 `SS`를 `confirm_threshold` 이상 상향 돌파하면 상승추세 재개로 본다.

- `downward_trend` 재개
  - 자연조정 이후 가격이 이전 `BB`를 `confirm_threshold` 이상 하향 돌파하면 하락추세 재개로 본다.

- 상승추세 종료 경고
  - 자연반등이 이전 `SS` 근처에서 끝나고 다시 `confirm_threshold` 이상 하락하면 상승추세 종료 위험으로 본다.

- 하락추세 종료 경고
  - 자연조정이 이전 `BB` 근처에서 끝나고 다시 `confirm_threshold` 이상 반등하면 하락추세 종료 위험으로 본다.

## Implementation Notes

- 피벗은 `고가/저가`가 아니라 그 열에 실제로 `기록된 마지막 가격`이다.
- 차트 표시는 내부 추적값이 아니라 `확정된 피벗 이벤트`만 찍어야 한다.
- 상태 계산 엔진은 다음을 분리해야 한다.
  - 현재 기록 중인 열과 그 열의 마지막 기록가
  - 확정된 피벗 이벤트(`S/B/SS/BB`)
  - 이전 피벗을 이용한 확인 규칙
- 초기 부트스트랩은 원문에 명시되지 않았으므로 별도 규칙으로 분리해야 한다.
