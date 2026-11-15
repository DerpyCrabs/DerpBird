cmake_minimum_required(VERSION 3.30)
project(DerpBirdNativeTests LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)
enable_testing()
# Requires a compositor and an input serial; built only when explicitly selected.
add_executable(test-secret-clipboard EXCLUDE_FROM_ALL secret-clipboard.cpp)
target_include_directories(test-secret-clipboard PRIVATE ../../native/Qt)
target_link_libraries(test-secret-clipboard PRIVATE Qt6::Core Qt6::Gui Qt6::Widgets)
target_compile_options(test-secret-clipboard PRIVATE -Wall -Wextra -Werror)
# Pure geometry/lifecycle test: no compositor is needed.
add_executable(test-content-surface content-surface.cpp)
target_include_directories(test-content-surface PRIVATE ../../native/Qt)
target_link_libraries(test-content-surface PRIVATE Qt6::Core Qt6::Gui)
target_compile_options(test-content-surface PRIVATE -Wall -Wextra -Werror)
add_test(NAME content-surface-lifecycle COMMAND test-content-surface)

set(DERPBIRD_ENGINE_BUILD "" CACHE PATH "Configured Ladybird build with compiled LibURL and AK")
if(DERPBIRD_ENGINE_BUILD)
    set(ENGINE_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/ladybird")
    # Explicit corpus input, never an empty/default ctest pass.
    add_executable(blocker-corpus EXCLUDE_FROM_ALL blocker-corpus.cpp)
    target_compile_options(blocker-corpus PRIVATE -O2)
    target_include_directories(blocker-corpus PRIVATE
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(blocker-corpus PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-web.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_executable(test-navigation-policy navigation-policy.cpp)
    target_include_directories(test-navigation-policy PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-navigation-policy PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME navigation-policy COMMAND test-navigation-policy)
    add_executable(test-user-styles user-styles.cpp)
    target_include_directories(test-user-styles PRIVATE ../../native/WebContent
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-user-styles PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME user-style-matching COMMAND test-user-styles)
    add_executable(test-style-store style-store.cpp)
    target_include_directories(test-style-store PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-style-store PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME user-style-persistence COMMAND test-style-store)
    add_executable(test-source-folders source-folders.cpp "${ENGINE_SOURCE}/UI/Qt/StringUtils.cpp")
    target_include_directories(test-source-folders PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-source-folders PRIVATE Qt6::Core Qt6::Widgets
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME source-folder-dependencies COMMAND test-source-folders)
    add_executable(test-script-store script-store.cpp)
    target_include_directories(test-script-store PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-store PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-persistence COMMAND test-script-store)
    add_executable(test-script-install script-install.cpp "${ENGINE_SOURCE}/Tests/LibWebView/HeadlessTest.cpp")
    target_include_directories(test-script-install PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}/Tests/LibWebView" "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries"
        "${ENGINE_SOURCE}/Services" "${DERPBIRD_ENGINE_BUILD}/Services"
        "${DERPBIRD_ENGINE_BUILD}" "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_compile_definitions(test-script-install PRIVATE LADYBIRD_BINARY_PATH="${DERPBIRD_ENGINE_BUILD}/bin")
    target_link_libraries(test-script-install PRIVATE Qt6::Core Qt6::Gui
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-imagedecoderclient.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webview.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webcommon.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ipc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-threading.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gfx.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-requests.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-http.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-filesystem.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-dependency-install COMMAND test-script-install)
    set_tests_properties(userscript-dependency-install PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    add_executable(test-file-picker file-picker.cpp "${ENGINE_SOURCE}/UI/Qt/StringUtils.cpp" "${ENGINE_SOURCE}/Tests/LibWebView/HeadlessTest.cpp")
    target_include_directories(test-file-picker PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}/Tests/LibWebView" "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries"
        "${ENGINE_SOURCE}/Services" "${DERPBIRD_ENGINE_BUILD}/Services"
        "${DERPBIRD_ENGINE_BUILD}" "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_compile_definitions(test-file-picker PRIVATE LADYBIRD_BINARY_PATH="${DERPBIRD_ENGINE_BUILD}/bin")
    target_link_libraries(test-file-picker PRIVATE Qt6::Core Qt6::Gui Qt6::Widgets
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-imagedecoderclient.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webview.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webcommon.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ipc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-threading.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gfx.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-requests.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-http.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-filesystem.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME shell-file-picker COMMAND test-file-picker)
    set_tests_properties(shell-file-picker PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    add_executable(test-script-values script-values.cpp)
    target_include_directories(test-script-values PRIVATE ../../native/WebUI
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-values PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-values COMMAND test-script-values)
    add_executable(test-script-value-service script-value-service.cpp)
    target_include_directories(test-script-value-service PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-value-service PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-worker COMMAND test-script-value-service)
    add_executable(test-script-value-authority script-value-authority.cpp)
    target_include_directories(test-script-value-authority PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-value-authority PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-authority COMMAND test-script-value-authority)
    add_executable(test-script-value-requests script-value-requests.cpp)
    target_include_directories(test-script-value-requests PRIVATE ../../native/WebContent
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-value-requests PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-requests COMMAND test-script-value-requests)
    add_executable(test-script-value-events script-value-events.cpp)
    target_include_directories(test-script-value-events PRIVATE ../../native/WebUI
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-value-events PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-events COMMAND test-script-value-events)
    add_executable(test-script-value-dispatcher script-value-dispatcher.cpp)
    target_include_directories(test-script-value-dispatcher PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-script-value-dispatcher PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-dispatcher COMMAND test-script-value-dispatcher)
    add_executable(test-script-value-host script-value-host.cpp "${ENGINE_SOURCE}/Tests/LibWebView/HeadlessTest.cpp")
    target_compile_definitions(test-script-value-host PRIVATE LADYBIRD_BINARY_PATH="${DERPBIRD_ENGINE_BUILD}/bin")
    target_include_directories(test-script-value-host PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${ENGINE_SOURCE}/Services"
        "${ENGINE_SOURCE}/Tests/LibWebView" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries" "${DERPBIRD_ENGINE_BUILD}/Services")
    target_link_libraries(test-script-value-host PRIVATE Qt6::Core Qt6::Gui
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-imagedecoderclient.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ipc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-requests.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-http.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webview.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-webcommon.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-threading.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gfx.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-gc.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-filesystem.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME userscript-value-host COMMAND test-script-value-host)
    add_executable(test-credential-store credential-store.cpp)
    target_include_directories(test-credential-store PRIVATE ../../native/WebUI
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-credential-store PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME password-credential-catalog COMMAND test-credential-store)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(SECRET REQUIRED IMPORTED_TARGET libsecret-1>=0.19)
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    add_executable(test-secret-store secret-store.cpp)
    target_include_directories(test-secret-store PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}")
    target_link_libraries(test-secret-store PRIVATE PkgConfig::SECRET
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_executable(test-secret-service secret-service.cpp)
    target_include_directories(test-secret-service PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}")
    target_link_libraries(test-secret-service PRIVATE Qt6::Core PkgConfig::SECRET
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME password-secret-worker COMMAND test-secret-service)
    set_tests_properties(password-secret-worker PROPERTIES TIMEOUT 10)
    add_executable(test-secret-service-platform secret-service-platform.cpp)
    target_include_directories(test-secret-service-platform PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}")
    target_link_libraries(test-secret-service-platform PRIVATE Qt6::Core PkgConfig::SECRET
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME password-platform-worker COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/run-secret-store.py" "$<TARGET_FILE:test-secret-service-platform>")
    set_tests_properties(password-platform-worker PROPERTIES TIMEOUT 50)
    add_executable(test-credential-vault credential-vault.cpp)
    target_include_directories(test-credential-vault PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-credential-vault PRIVATE Qt6::Core PkgConfig::SECRET
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME password-credential-vault COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/run-secret-store.py" "$<TARGET_FILE:test-credential-vault>")
    set_tests_properties(password-credential-vault PROPERTIES TIMEOUT 50)
    add_executable(test-credential-service credential-service.cpp)
    target_include_directories(test-credential-service PRIVATE ../../native/Qt
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-credential-service PRIVATE Qt6::Core PkgConfig::SECRET
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME password-profile-service COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/run-secret-store.py" "$<TARGET_FILE:test-credential-service>")
    set_tests_properties(password-profile-service PROPERTIES TIMEOUT 50)
    add_test(NAME password-system-secret-store COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/run-secret-store.py" "$<TARGET_FILE:test-secret-store>")
    set_tests_properties(password-system-secret-store PROPERTIES TIMEOUT 50)
    add_test(NAME password-secret-service-restart COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/run-secret-restart.py" "$<TARGET_FILE:test-secret-store>")
    set_tests_properties(password-secret-service-restart PROPERTIES TIMEOUT 50)
    add_executable(benchmark-script-values EXCLUDE_FROM_ALL script-values-benchmark.cpp)
    target_compile_options(benchmark-script-values PRIVATE -O2)
    target_include_directories(benchmark-script-values PRIVATE ../../native/WebUI
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(benchmark-script-values PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-database.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-core.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_executable(benchmark-user-styles EXCLUDE_FROM_ALL style-benchmark.cpp)
    target_compile_options(benchmark-user-styles PRIVATE -O2)
    target_include_directories(benchmark-user-styles PRIVATE ../../native/WebContent
        "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}"
        "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(benchmark-user-styles PRIVATE
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-regex.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
endif()

find_package(SQLite3 REQUIRED)
add_executable(test-chrome-import chrome-import.cpp)
target_include_directories(test-chrome-import PRIVATE ../../native/Qt)
target_link_libraries(test-chrome-import PRIVATE Qt6::Core)
if (TARGET SQLite3::SQLite3)
    target_link_libraries(test-chrome-import PRIVATE SQLite3::SQLite3)
else()
    target_link_libraries(test-chrome-import PRIVATE SQLite::SQLite3)
endif()
target_compile_options(test-chrome-import PRIVATE -Wall -Wextra -Werror -UNDEBUG)
add_test(NAME chrome-import COMMAND test-chrome-import)

if(DERPBIRD_ENGINE_BUILD)
    add_executable(test-proxy-routing proxy-routing.cpp)
    target_include_directories(test-proxy-routing PRIVATE "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${DERPBIRD_ENGINE_BUILD}" "${DERPBIRD_ENGINE_BUILD}/Libraries")
    target_link_libraries(test-proxy-routing PRIVATE Qt6::Core
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-http.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-url.so"
        "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-ak.so")
    add_test(NAME proxy-routing COMMAND test-proxy-routing)
endif()

# Every test is bounded. Preserve tighter service-specific limits above.
get_property(derpbird_tests DIRECTORY PROPERTY TESTS)
foreach(test IN LISTS derpbird_tests)
    get_property(timeout TEST ${test} PROPERTY TIMEOUT)
    if(NOT timeout)
        set_tests_properties(${test} PROPERTIES TIMEOUT 90)
    endif()
    set_tests_properties(${test} PROPERTIES LABELS fast)
endforeach()
if(DERPBIRD_ENGINE_BUILD)
    set_tests_properties(userscript-dependency-install userscript-value-requests
        PROPERTIES LABELS "slow;integration")
endif()
