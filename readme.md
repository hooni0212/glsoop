작업 프로토콜
1. 모든 작업 이전에 vsc를 켜면 저장된 main을 pull 해온다.
    # 1) main 브랜치로 이동
        git checkout main
    # 2) 원격(main)의 최신 내용을 가져오기
        git pull origin main

2. 새 브랜치(분기)를 파고, 이곳에서 작업을 시작한다.
    # 1) (이미 1단계에서 main 최신화가 끝난 상태라고 가정)
        git checkout main
    # 2) 새 브랜치 생성 + 해당 브랜치로 이동
        git checkout -b feature/브랜치-이름
        # 예시
        # git checkout -b feature/mypage-card-ui

3. 브랜치에서 기능 추가, 코드 수정
    그냥 하고 싶은거 다 하면 됨.

4. 커밋
    명령어 쓸 생각하지 말고, 그냥 vsc 기능을 이용합시다.
        소스제어 부분에서 파란색으로 된 버튼 아랫쪽에 변경사항이 있음.(코드를 수정했다는 가정하에)
        그럼 그 변경사항에 마우스를 올렸을 때 오른쪽에 + 버튼이 보일텐데, 그걸 눌러서 스테이징 시키고, 커밋하면 됨

5. 브랜치를 원격 저장소(GitHub)에 push 한다.
    - 커밋까지 끝났다면, 이제 이 브랜치를 GitHub에 올려서(PR 만들 준비) 다른 사람도 볼 수 있게 한다.
    - vsc(Visual Studio Code)에서 하는 방법:
        1) 왼쪽 '소스 제어' 탭을 연다.
        2) 위쪽에 '…'(더보기) 버튼을 클릭한다.
        3) 'Push' 또는 'Push to...' 메뉴를 선택한다.(한글로 설정을 바꾼 경우에는 "다음으로 푸시..."으로 뜬다)
        4) 처음으로 푸시하는 브랜치라면, 'Publish Branch' 같은 버튼이 나올 수 있는데, 이때 확인을 눌러서 원격에도 같은 이름의 브랜치를 만든다.

6. GitHub에서 Pull Request(PR)를 만든다.
    - 브랜치가 GitHub에 올라가면, 웹 브라우저로 GitHub repo에 들어가서 PR을 만든다.
    - 기본 흐름:
        1) GitHub에서 glsoop 저장소로 이동한다.
        2) 'Compare & pull request' 버튼이 보이면 클릭한다. (없다면, 'Pull requests' 탭에서 'New pull request'를 누르고, base는 main, compare는 방금 push한 브랜치로 선택한다.)
        3) PR 제목과 설명을 적는다.
            - 예시 제목: `[feat] 마이페이지 카드 hover 효과 추가`
            - 예시 내용:
                - 요약: 메인 페이지 글 카드에 hover 효과 추가
                - 변경 내용:
                    - 카드에 transition, box-shadow, transform 효과 적용
                - 테스트:
                    - 로컬에서 hover 동작 확인 완료
        4) 'Create pull request' 버튼을 눌러 PR을 생성한다.
    - 협업 규칙:
        - 가능하면 내가 만든 PR은 **다른 사람이 한 번 보고 merge**한다.
        - 급한 경우나 단순 변경(PR 내용이 매우 짧고 명확한 경우)은 팀에서 합의하고 본인이 merge해도 된다.

7. PR이 승인되면 main에 merge 하고, 모두 main을 다시 pull 한다.
    - PR이 승인되면 GitHub에서 'Merge pull request' → 'Confirm merge'를 눌러 main에 병합한다.
    - 병합이 끝난 후, 각자 로컬에서는 다음을 수행한다:
        1) vsc에서 main 브랜치로 이동
            ```bash
            git checkout main
            ```
        2) 최신 main을 다시 가져오기
            ```bash
            git pull origin main
            ```
        - 이렇게 해서 **모든 사람이 동일한 최신 main 상태를 가지도록 유지**한다.

8. 사용이 끝난 브랜치는 정리한다. (선택이지만 추천)
    - PR이 merge된 브랜치는 더 이상 쓸 일이 없으면 지워준다.
    - GitHub 웹에서:
        - PR 페이지 아래쪽에 'Delete branch' 버튼을 눌러 원격 브랜치를 삭제한다.
    - 로컬(vsc 터미널)에서는:
        ```bash
        git branch -d feature/브랜치-이름
        ```
    - 이렇게 하면 오래된 브랜치가 쌓이지 않고, 브랜치 목록이 깔끔해진다.
