# Design Update Log

## Goal

WallStreetZen을 직접 복제하지 않고, 다음 원칙을 현재 제품에 맞게 번역하는 방향으로 디자인을 재정비했다.

- 기능 우선
- 정보 밀도는 높게, 장식은 낮게
- 카드/패널 중심 레이아웃
- 절제된 블루 기반 시스템
- 과한 애니메이션 제거
- 가독성과 빠른 스캔 우선

## Core System

다음 공통 토큰과 패턴을 도입했다.

- 전역 색상/표면/테두리/그림자 토큰 추가
- `app-shell`, `app-card`, `app-card-strong`, `app-input` 공통 클래스 추가
- 배경은 평면 단색 대신 아주 약한 블루 계열 분위기만 유지
- 타이포는 기본 Arial 계열에서 Geist 기반으로 통일
- 입력창/버튼/토글을 둥근 모서리와 얇은 경계선 중심으로 정리

관련 파일:

- [src/app/globals.css](/Users/myunghoon/my-stock-scheduler/src/app/globals.css)
- [src/app/layout.tsx](/Users/myunghoon/my-stock-scheduler/src/app/layout.tsx)

## Navigation

초기 좌측 사이드바 구조를 상단 네비게이션 구조로 변경했다.

- 주요 메뉴를 상단에서 바로 접근 가능하게 변경
- 현재 활성 섹션은 상단 pill 스타일로 강조
- 하위 메뉴가 있는 섹션은 2차 서브네비 표시
- 로그인 상태 사용자 정보와 로그아웃 버튼을 헤더 우측에 배치
- auth 페이지와 `/m` 계열 페이지에서는 숨김 유지

관련 파일:

- [src/components/Sidebar.tsx](/Users/myunghoon/my-stock-scheduler/src/components/Sidebar.tsx)
- [src/app/layout.tsx](/Users/myunghoon/my-stock-scheduler/src/app/layout.tsx)

## Scheduler

스케줄러는 여러 차례 조정했다.

최종 방향:

- 상단 요약 카드 제거
- 캘린더가 첫 시선에 들어오게 메인 영역 확장
- 일정 배지는 두 상태만 구분
  - 참여한 일정: 연한 노랑/앰버 계열
  - 참여하지 않은 일정: 흰 배경
- 참여하지 않은 일정은 인원 숫자만 상태 색상 표시
  - 여유 있음: 초록
  - 마감: 빨강
- 스케줄러 전체 폰트와 캘린더 타이포를 키우고 굵게 조정

관련 파일:

- [src/app/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/page.tsx)
- [src/app/calendar-style.css](/Users/myunghoon/my-stock-scheduler/src/app/calendar-style.css)

## Favorites

- 좌측 그룹 패널과 우측 종목 패널을 공통 카드 셸로 정리
- 검색 드롭다운, 그룹 생성, 그룹 선택, 종목 카드 톤 통일
- hover/active 상태를 전역 디자인 시스템에 맞게 변경

관련 파일:

- [src/app/favorites/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/favorites/page.tsx)

## Band Chart

- 좌측 설정 패널, 중앙 차트 패널, 우측 관심종목 패널 외곽 구조 통일
- 서버/편집 모드 토글, PER/PBR/POR 토글, 입력 표, 목표가 패널 스타일 정리
- 관심종목 패널도 전역 시스템과 같은 pill/카드 구조로 정리

관련 파일:

- [src/app/chart/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/chart/page.tsx)

## Market Index

- 상단 제목/탭/필터 영역을 공통 시스템으로 정리
- 지수/선도주 화면의 좌우 패널을 같은 카드 셸로 통일
- 테이블/필터/검색 입력의 외곽 스타일 정리

관련 파일:

- [src/app/market-index/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/market-index/page.tsx)

## Discovery

다음 페이지들을 같은 시스템으로 맞췄다.

- RS 분석
- 시총 TOP 100
- 거래대금 분석

공통 변경:

- 좌측 리스트 패널 + 우측 차트 패널 구조 유지
- 패널 외곽, 탭, 필터, 상태 텍스트, 페이지네이션, 태그를 전역 시스템에 맞게 정리
- 선택 상태는 연한 블루 배경으로 통일
- 업종/테마 태그도 동일한 배지 톤 사용

관련 파일:

- [src/app/discovery/rs/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/discovery/rs/page.tsx)
- [src/app/discovery/cap/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/discovery/cap/page.tsx)
- [src/app/discovery/volume/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/discovery/volume/page.tsx)

## Auth

로그인 페이지를 전역 카드 시스템으로 변경했다.

- 중앙 단일 카드 구조
- 헤더 라벨 + 큰 제목 구조
- 입력창을 `app-input`으로 통일
- 로그인/회원가입 전환 영역 톤 정리

관련 파일:

- [src/app/login/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/login/page.tsx)

## Admin / MH

`admin/MH`는 별도 서브 워크스페이스처럼 보이도록 정리했다.

- 전역 상단 `Sidebar`의 MH 서브메뉴를 유지하고, 중복되던 MH 전용 상단 서브네비는 제거
- `chart`, `volume`, `index`, `portfolio`를 같은 카드 시스템으로 정리
- 검색창, 토글, 탭, 필터, 차트 컨테이너 외곽 통일
- 공통 상단 헤더를 압축해서 세로 공간 확보
- 차트가 있는 `chart`, `volume`, `index` 화면에 `차트 크게 보기` 전체화면 옵션 추가
- 차트 페이지는 상단 별도 카드 대신 차트 오버레이 중심으로 재배치해서 차트 세로 높이를 극대화
- `index`는 상단 제어 영역을 압축하고 차트 + 상태변경 목록 2열 작업 화면으로 재구성
- `index` 우측 상태변경 표는 폭을 키우고 날짜 줄바꿈을 막아 가독성 보완
- `portfolio`는 `현재 포지션`, `청산 매매`, `테이블`, `업종별 비중`을 한 줄 작업 바에 통합
- `portfolio`는 보조 리스트를 추가하지 않고 기존 메인 테이블 하나를 중심으로 유지
- `portfolio` 메인 테이블은 종목명 열 좌측 고정, 액션 열 우측 고정으로 바꿔 많은 종목을 봐도 스캔과 편집이 쉽게 조정

관련 파일:

- [src/app/admin/MH/layout.tsx](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/layout.tsx)
- [src/app/admin/MH/chart/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/chart/page.tsx)
- [src/app/admin/MH/index/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/index/page.tsx)
- [src/app/admin/MH/volume/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/volume/page.tsx)
- [src/app/admin/MH/portfolio/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/portfolio/page.tsx)
- [src/components/FullscreenPanel.tsx](/Users/myunghoon/my-stock-scheduler/src/components/FullscreenPanel.tsx)
- [src/components/LivermoreStateChart.tsx](/Users/myunghoon/my-stock-scheduler/src/components/LivermoreStateChart.tsx)

## Validation Notes

확인한 내용:

- 여러 변경 파일에 대해 ESLint를 페이지 단위로 반복 실행
- 일부 파일은 통과
- 일부 기존 파일은 원래부터 `any`, hook dependency 등 ESLint 부채가 존재

디자인 수정 때문에 새로 생긴 문제와 기존 문제는 분리해서 봐야 한다.

## Next Candidates

다음 우선순위 후보:

- `src/app/admin/page.tsx`
- `src/app/admin/index/page.tsx`
- `src/app/admin/game/page.tsx`
- `src/app/forgot-password/page.tsx`
- `src/app/update-password/page.tsx`

## Update Rule

앞으로 디자인 관련 수정을 할 때는 이 파일에 다음을 같이 기록한다.

- 어떤 페이지를 바꿨는지
- 어떤 디자인 의도를 반영했는지
- 공통 시스템 변경인지, 페이지 단위 변경인지
- 검증 상태가 어떤지
