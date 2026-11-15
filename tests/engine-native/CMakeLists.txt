cmake_minimum_required(VERSION 3.30)
project(DerpBirdEngineSuites LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
set(DERPBIRD_ENGINE_BUILD "" CACHE PATH "Configured and built Ladybird engine")
if(NOT EXISTS "${DERPBIRD_ENGINE_BUILD}/CMakeCache.txt")
    message(FATAL_ERROR "Build the selected engine before configuring its suites")
endif()
get_filename_component(ENGINE_SOURCE "../../vendor/ladybird" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
add_library(derpbird-test-runtime STATIC
    "${ENGINE_SOURCE}/Tests/LibWebView/HeadlessTest.cpp"
    "${ENGINE_SOURCE}/Libraries/LibWeb/DOM/IDLEventListener.cpp"
    "${ENGINE_SOURCE}/Libraries/LibWeb/WebIDL/CallbackType.cpp"
    "${ENGINE_SOURCE}/Libraries/LibTest/TestMain.cpp")
target_compile_definitions(derpbird-test-runtime PUBLIC LADYBIRD_BINARY_PATH="${DERPBIRD_ENGINE_BUILD}/bin")
target_include_directories(derpbird-test-runtime PUBLIC
    "${ENGINE_SOURCE}" "${ENGINE_SOURCE}/Libraries" "${ENGINE_SOURCE}/Services"
    "${ENGINE_SOURCE}/Tests/LibWebView" "${ENGINE_SOURCE}/Tests/LibWeb" "${DERPBIRD_ENGINE_BUILD}"
    "${DERPBIRD_ENGINE_BUILD}/Libraries" "${DERPBIRD_ENGINE_BUILD}/Services")
# Use the existing engine libraries, without compiling the hundreds of upstream
# test translation units included in TestLibWeb and TestLibWebView.
foreach(library IN ITEMS test webview web webcommon compositing gfx gc core ak url
        filesystem ipc threading requests http imagedecoderclient imagedecoders
        crypto regex unicode textcodec database dns)
    target_link_libraries(derpbird-test-runtime PUBLIC "${DERPBIRD_ENGINE_BUILD}/lib/liblagom-${library}.so")
endforeach()
target_compile_options(derpbird-test-runtime PUBLIC -Og -g1 -Wno-invalid-offsetof)
enable_testing()
file(GLOB suites CONFIGURE_DEPENDS "../../native/Tests/Test*.cpp" "../../native/EngineTests/Test*.cpp")
list(APPEND suites "${ENGINE_SOURCE}/Tests/LibWeb/TestContentBlocker.cpp")
foreach(source IN LISTS suites)
    get_filename_component(suite "${source}" NAME_WE)
    add_executable(${suite} "${source}")
    target_link_libraries(${suite} PRIVATE derpbird-test-runtime)
    add_test(NAME ${suite} COMMAND ${suite} --tests --suite ${suite})
    set_tests_properties(${suite} PROPERTIES TIMEOUT 180 LABELS engine
        ENVIRONMENT "LADYBIRD_SOURCE_DIR=${ENGINE_SOURCE}")
endforeach()
